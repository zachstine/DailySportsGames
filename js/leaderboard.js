import { DRILL_MS, validDate, normalize } from "./core.js";
import { creatorName } from "./puzzles.js";

function player(connection, expectedUid) {
  const user = connection.auth.currentUser;
  if (!user || user.isAnonymous || expectedUid && user.uid !== expectedUid) throw new Error("Sign in to rank your daily run.");
  return user.uid;
}
const runRef = (connection, date, uid) => connection.store.doc(connection.db, `drillRuns/${date}/players`, uid);
export async function startRankedDrill(connection, date, name) {
  if (!validDate(date)) throw new Error("Invalid daily date.");
  const uid = player(connection), displayName = creatorName(name, true);
  const { store, db } = connection, reference = runRef(connection, date, uid);
  await store.runTransaction(db, async transaction => {
    const existing = await transaction.get(reference);
    player(connection, uid);
    if (!existing.exists()) transaction.set(reference, { playerId: uid, date, displayName, startedAt: store.serverTimestamp(), found: [] });
  });
  const snapshot = await store.getDocFromServer(reference);
  player(connection, uid);
  const run = snapshot.data();
  return { ...run, startedAt: run.startedAt.toMillis(), deadline: run.startedAt.toMillis() + DRILL_MS };
}
export async function acceptRankedAnswer(connection, date, key, expectedUid) {
  const uid = player(connection, expectedUid), { store, db } = connection, reference = runRef(connection, date, uid);
  return store.runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error("Start your ranked clock first.");
    const run = snapshot.data();
    player(connection, uid);
    if (run.found.includes(key)) return run.found;
    // Rules check the canonical key and server deadline as well.
    if (!normalize(key) || Date.now() >= run.startedAt.toMillis() + DRILL_MS) throw new Error("The two minutes are up.");
    const found = [...run.found, key];
    transaction.update(reference, { found });
    return found;
  });
}
export async function publishDrillScore(connection, date, expectedUid) {
  const uid = player(connection, expectedUid), { store, db } = connection;
  const reference = store.doc(db, `drillLeaderboards/${date}/scores`, uid);
  return store.runTransaction(db, async transaction => {
    const run = await transaction.get(runRef(connection, date, uid));
    const score = await transaction.get(reference);
    player(connection, uid);
    if (!run.exists()) throw new Error("Your ranked run wasn't found.");
    if (!score.exists()) transaction.set(reference, { displayName: run.data().displayName, score: run.data().found.length, completedAt: store.serverTimestamp() });
    return { found: run.data().found, score: run.data().found.length };
  });
}
export async function drillLeaderboard(connection, date) {
  const { db, store } = connection;
  const snapshot = await store.getDocsFromServer(store.query(store.collection(db, `drillLeaderboards/${date}/scores`), store.orderBy("score", "desc"), store.limit(25)));
  let rank = 0, previous = null;
  return snapshot.docs.map((doc, index) => { const value = doc.data(); if (value.score !== previous) rank = index + 1; previous = value.score; return { id: doc.id, ...value, rank }; });
}
