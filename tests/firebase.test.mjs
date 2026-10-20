import test from "node:test";
import assert from "node:assert/strict";
import { writeDailyResult } from "../js/firebase.js";

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
