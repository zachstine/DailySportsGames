import test from "node:test";
import assert from "node:assert/strict";
import { writeDailyResult, ensurePlayerProfile, signInPlayerWithEmail, signInPlayerWithGoogle, signOutPlayer } from "../js/firebase.js";

const result = { game: "player", date: "2026-10-20", mode: "daily", done: true, score: 5, won: true, checks: 0, reveals: 0 };

function connection({ failure, existing } = {}) {
  const writes = [], reads = [];
  return {
    writes, reads, db: {}, auth: { currentUser: { uid: "guest-123" } },
    store: {
      doc: (_db, collection, id) => `${collection}/${id}`,
      serverTimestamp: () => "server-time",
      setDoc: async (path, data) => { writes.push({ path, data }); if (failure) throw failure; },
      getDocFromServer: async path => { reads.push(path); return { exists: () => Boolean(existing), data: () => existing }; }
    }
  };
}

test("daily results use one guest/date/game ID and only score metadata", async () => {
  const client = connection();
  await writeDailyResult(client, result);
  assert.deepEqual(client.writes, [{
    path: "results/guest-123_2026-10-20_player",
    data: { playerId: "guest-123", date: result.date, game: "player", score: 5, won: true, checks: 0, reveals: 0, completedAt: "server-time" }
  }]);
  assert.deepEqual(client.reads, []);
});

test("zero-point completions and assisted crosswords are valid daily results", async () => {
  const client = connection();
  await writeDailyResult(client, { ...result, score: 0, won: false });
  await writeDailyResult(client, { ...result, game: "ladder", score: 0, won: false });
  await writeDailyResult(client, { ...result, game: "cross", score: 1, checks: 3, reveals: 2 });
  assert.equal(client.writes.length, 3);
  assert.equal(client.writes[2].data.reveals, 2);
});

test("only crosswords accept a measured duration, and retries preserve the immutable original time", async () => {
  const timed = { ...result, game: "cross", score: 1, checks: 2, reveals: 1, elapsedMs: 123456 };
  const client = connection(); await writeDailyResult(client, timed);
  assert.equal(client.writes[0].data.elapsedMs, 123456);
  for (const elapsedMs of [-1, 1.5, null, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(writeDailyResult(client, { ...timed, elapsedMs }), /Invalid daily result/);
  }
  await assert.rejects(writeDailyResult(client, { ...result, elapsedMs: 1000 }), /Invalid daily result/);
  const failure = Object.assign(new Error("immutable"), { code: "permission-denied" });
  const existing = { ...client.writes[0].data, completedAt: "original-time" };
  await writeDailyResult(connection({ failure, existing }), timed);
  await assert.rejects(writeDailyResult(connection({ failure, existing }), { ...timed, elapsedMs: 123457 }), failure);
});

test("practice, preview, unfinished, and invalid results never reach the database writer", async () => {
  const client = connection();
  for (const change of [{ mode: "practice" }, { mode: "preview" }, { done: false }, { score: 6 }, { won: false }, { checks: 1 }, { date: "2026-02-30" }]) {
    await assert.rejects(writeDailyResult(client, { ...result, ...change }), /Invalid daily result/);
  }
  assert.deepEqual(client.writes, []);
});

test("retry after a lost acknowledgement accepts the original immutable result", async () => {
  const failure = Object.assign(new Error("immutable"), { code: "permission-denied" });
  const existing = { playerId: "guest-123", date: result.date, game: result.game, score: 5, won: true, checks: 0, reveals: 0, completedAt: "original-time" };
  const client = connection({ failure, existing });
  await writeDailyResult(client, result);
  assert.equal(client.writes.length, 1); assert.equal(client.reads.length, 1);
  assert.equal(existing.completedAt, "original-time");
  await assert.rejects(writeDailyResult(connection({ failure, existing: { ...existing, score: 1 } }), result), failure);
  await assert.rejects(writeDailyResult(connection({ failure }), result), failure);
});

test("network failures remain failures so the local queue can retry later", async () => {
  const failure = Object.assign(new Error("offline"), { code: "unavailable" });
  const client = connection({ failure });
  await assert.rejects(writeDailyResult(client, result), failure);
  assert.deepEqual(client.reads, []);
});

test("a pending score cannot be recorded under a different signed-in account", async () => {
  const client = connection();
  await assert.rejects(writeDailyResult(client, result, "another-user"), /account changed/);
  assert.deepEqual(client.writes, []);
});

test("only registered accounts create private user profiles, with no owner privilege", async () => {
  const guest = connection(); guest.auth.currentUser.isAnonymous = true;
  assert.equal(await ensurePlayerProfile(guest), false);
  assert.deepEqual(guest.writes, []);
  const user = connection(); user.auth.currentUser.isAnonymous = false;
  assert.equal(await ensurePlayerProfile(user), true);
  assert.deepEqual(user.writes[0], { path: "users/guest-123", data: { role: "user", createdAt: "server-time" } });
  const existing = connection({ existing: { role: "user" } });
  await ensurePlayerProfile(existing); assert.deepEqual(existing.writes, []);
});

test("email signup links a guest identity; existing account login uses its own identity", async () => {
  const calls = [];
  const guest = { uid: "guest-a", isAnonymous: true };
  const client = { auth: { currentUser: guest }, authModule: {
    EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
    linkWithCredential: async (user, credential) => { calls.push({ kind: "link", uid: user.uid, email: credential.email }); return { user }; },
    signInWithEmailAndPassword: async (_auth, email) => { calls.push({ kind: "sign-in", email }); return { user: { uid: "existing-user" } }; }
  } };
  const linked = await signInPlayerWithEmail(client, " player@example.com ", "test-placeholder", true);
  assert.equal(linked.user.uid, "guest-a");
  const signedIn = await signInPlayerWithEmail(client, "player@example.com", "test-placeholder");
  assert.equal(signedIn.user.uid, "existing-user");
  assert.deepEqual(calls, [{ kind: "link", uid: "guest-a", email: "player@example.com" }, { kind: "sign-in", email: "player@example.com" }]);
});

test("Google signup preserves a guest; an existing credential opens its account without deleting or merging guest data", async () => {
  const calls = [];
  class Provider { setCustomParameters() {} static credentialFromError() { return "existing-credential"; } }
  const client = { auth: { currentUser: { uid: "guest-a", isAnonymous: true } }, authModule: {
    GoogleAuthProvider: Provider,
    linkWithPopup: async user => { calls.push("link"); return { user }; },
    signInWithCredential: async () => { calls.push("existing"); return { user: { uid: "user-b" } }; }
  } };
  assert.equal((await signInPlayerWithGoogle(client)).user.uid, "guest-a");
  client.authModule.linkWithPopup = async () => { throw Object.assign(new Error("exists"), { code: "auth/credential-already-in-use" }); };
  assert.equal((await signInPlayerWithGoogle(client)).user.uid, "user-b");
  assert.deepEqual(calls, ["link", "existing"]);
});

test("signing out returns to anonymous play without changing saved records", async () => {
  const calls = [];
  const client = { auth: {}, authModule: {
    signOut: async () => calls.push("sign-out"),
    signInAnonymously: async () => { calls.push("guest"); return { user: { uid: "new-guest", isAnonymous: true } }; }
  } };
  const next = await signOutPlayer(client);
  assert.equal(next.user.isAnonymous, true);
  assert.deepEqual(calls, ["sign-out", "guest"]);
});

test("a canceled or failed Google link leaves the guest signed in", async () => {
  const guest = { uid: "guest-a", isAnonymous: true };
  const failure = Object.assign(new Error("canceled"), { code: "auth/popup-closed-by-user" });
  class Provider { setCustomParameters() {} }
  const client = { auth: { currentUser: guest }, authModule: { GoogleAuthProvider: Provider, linkWithPopup: async () => { throw failure; } } };
  await assert.rejects(signInPlayerWithGoogle(client), failure);
  assert.equal(client.auth.currentUser.uid, "guest-a");
});
