import { firebaseConfig } from "../firebase-config.js";
import { releaseTime, validatePuzzle, validDate, GAMES } from "./core.js";

export const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
const SDK = "https://www.gstatic.com/firebasejs/13.0.0";
let connection, playerConnection;

export async function connect() {
  if (!configured) throw new Error("Firebase is not connected. Add your web app config to firebase-config.js.");
  if (!connection) connection = (async () => {
    const [app, store] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-firestore.js`)]);
    const instance = app.getApps().length ? app.getApp() : app.initializeApp(firebaseConfig);
    return { instance, appModule: app, store, db: store.getFirestore(instance) };
  })().catch(error => { connection = null; throw error; });
  return connection;
}

export async function getDailyPuzzle(date) {
  const { db, store } = await connect();
  const snapshot = await store.getDocFromServer(store.doc(db, "dailyPuzzles", date));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!data.published || data.unlockAt.toMillis() > Date.now()) return null;
  const errors = validatePuzzle(data.puzzle);
  if (errors.length || data.puzzle.date !== date) throw new Error("Today's puzzle needs an owner correction. Please try again later.");
  return data.puzzle;
}

export async function connectOwner() {
  const [{ db, store, instance }, authModule] = await Promise.all([connect(), import(`${SDK}/firebase-auth.js`)]);
  const auth = authModule.getAuth(instance);
  await authModule.setPersistence(auth, authModule.browserSessionPersistence);
  await auth.authStateReady();
  return { db, store, auth, authModule };
}

async function connectPlayer() {
  if (!playerConnection) playerConnection = (async () => {
    const [{ appModule, store }, authModule] = await Promise.all([connect(), import(`${SDK}/firebase-auth.js`)]);
    // A separate app keeps the guest identity independent of owner sign-in.
    const name = "daily-sports-players";
    const instance = appModule.getApps().find(app => app.name === name) || appModule.initializeApp(firebaseConfig, name);
    const auth = authModule.getAuth(instance);
    await authModule.setPersistence(auth, authModule.browserLocalPersistence);
    await auth.authStateReady();
    if (!auth.currentUser) await authModule.signInAnonymously(auth);
    return { db: store.getFirestore(instance), store, auth };
  })().catch(error => { playerConnection = null; throw error; });
  return playerConnection;
}

export async function recordDailyResult(result) {
  return writeDailyResult(await connectPlayer(), result);
}

export async function writeDailyResult(connection, result) {
  const { db, store, auth } = connection;
  const { date, game, score, won, checks, reveals } = result;
  const limit = game === "ladder" ? 15 : game === "player" ? 5 : 1;
  if (result.mode !== "daily" || result.done !== true || !validDate(date) || !GAMES.includes(game) ||
    !Number.isInteger(score) || score < 0 || score > limit || won !== (score > 0) ||
    !Number.isInteger(checks) || checks < 0 || checks > 1000000 ||
    !Number.isInteger(reveals) || reveals < 0 || reveals > 121 ||
    (game === "cross" ? score !== 1 : checks !== 0 || reveals !== 0)) throw new Error("Invalid daily result.");
  const playerId = auth.currentUser?.uid;
  if (!playerId) throw new Error("A player session is required to record a result.");
  const reference = store.doc(db, "results", `${playerId}_${date}_${game}`);
  const data = { playerId, date, game, score, won, checks, reveals };
  try {
    await store.setDoc(reference, { ...data, completedAt: store.serverTimestamp() });
  } catch (error) {
    if (error.code !== "permission-denied") throw error;
    // A lost acknowledgement or another tab can retry the same completion.
    // Rules keep the original result immutable; confirm it instead of updating it.
    const existing = await store.getDocFromServer(reference);
    if (!existing.exists() || !Object.entries(data).every(([key, value]) => existing.data()[key] === value)) throw error;
  }
}

export async function isOwner(connection, uid) {
  const { db, store } = connection;
  const snapshot = await store.getDocFromServer(store.doc(db, "owners", uid));
  return snapshot.exists() && snapshot.data().enabled === true;
}

export async function loadOwnerPuzzle(connection, date) {
  const { db, store } = connection;
  const snapshot = await store.getDocFromServer(store.doc(db, "dailyPuzzles", date));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function saveOwnerPuzzle(connection, puzzle, publish, expectedRevision) {
  const errors = validatePuzzle(puzzle);
  if (errors.length) throw new Error(errors.join("\n"));
  const { db, store, auth } = connection;
  const reference = store.doc(db, "dailyPuzzles", puzzle.date);
  return store.runTransaction(db, async transaction => {
    const old = await transaction.get(reference);
    const data = old.exists() ? old.data() : null;
    if ((data?.revision ?? 0) !== expectedRevision) {
      throw new Error("This date changed in another tab or is already scheduled. Use Load date before saving over it.");
    }
    // Published, already released puzzles are immutable: daily scores stay comparable.
    if (data?.published && data.unlockAt.toMillis() <= Date.now()) {
      throw new Error("This puzzle is already live. Keep today's games fixed and prepare another date.");
    }
    const revision = (data?.revision ?? 0) + 1;
    transaction.set(reference, {
      date: puzzle.date, puzzle, published: publish,
      unlockAt: store.Timestamp.fromMillis(releaseTime(puzzle.date)),
      updatedAt: store.serverTimestamp(), updatedBy: auth.currentUser.uid, revision
    });
    return revision;
  });
}

export async function upcomingPuzzles(connection, today) {
  const { db, store } = connection;
  const query = store.query(store.collection(db, "dailyPuzzles"), store.orderBy(store.documentId()), store.startAt(today), store.limit(14));
  const result = await store.getDocsFromServer(query);
  return result.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
