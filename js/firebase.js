import { firebaseConfig } from "../firebase-config.js";
import {
  releaseTime,
  validatePuzzle,
  validDate,
  validDailyResult,
  leagueOf,
  LEAGUES,
  puzzlePath,
} from "./core.js";
import { persistOwnerSlate } from "./community.js";

export const configured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);
const SDK = "https://www.gstatic.com/firebasejs/13.0.0";
let connection, playerConnection;

export async function connect() {
  if (!configured)
    throw new Error("Firebase is not connected. Add your web app config to firebase-config.js.");
  if (!connection)
    connection = (async () => {
      const [app, store] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-firestore.js`),
      ]);
      const instance = app.getApps().length ? app.getApp() : app.initializeApp(firebaseConfig);
      return { instance, appModule: app, store, db: store.getFirestore(instance) };
    })().catch((error) => {
      connection = null;
      throw error;
    });
  return connection;
}

export async function getDailyPuzzle(date, league = "general") {
  const { db, store } = await connect();
  const snapshot = await store.getDocFromServer(store.doc(db, ...puzzlePath(date, league)));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!data.published || data.unlockAt.toMillis() > Date.now()) return null;
  const errors = validatePuzzle(data.puzzle);
  if (errors.length || data.puzzle.date !== date || leagueOf(data.puzzle) !== league)
    throw new Error("Today's puzzle needs an owner correction. Please try again later.");
  return { ...data.puzzle, credits: data.credits || {} };
}

export async function connectOwner() {
  const [{ db, store, instance }, authModule] = await Promise.all([
    connect(),
    import(`${SDK}/firebase-auth.js`),
  ]);
  const auth = authModule.getAuth(instance);
  await authModule.setPersistence(auth, authModule.browserSessionPersistence);
  await auth.authStateReady();
  return { db, store, auth, authModule };
}

export async function connectPlayer() {
  if (!playerConnection)
    playerConnection = (async () => {
      const [{ appModule, store }, authModule] = await Promise.all([
        connect(),
        import(`${SDK}/firebase-auth.js`),
      ]);
      // A separate app keeps the guest identity independent of owner sign-in.
      const name = "daily-sports-players";
      const instance =
        appModule.getApps().find((app) => app.name === name) ||
        appModule.initializeApp(firebaseConfig, name);
      const auth = authModule.getAuth(instance);
      await authModule.setPersistence(auth, authModule.browserLocalPersistence);
      await auth.authStateReady();
      if (!auth.currentUser) await authModule.signInAnonymously(auth);
      return { db: store.getFirestore(instance), store, auth, authModule };
    })().catch((error) => {
      playerConnection = null;
      throw error;
    });
  return playerConnection;
}

export async function recordDailyResult(result, expectedUid) {
  return writeDailyResult(await connectPlayer(), result, expectedUid);
}

export async function writeDailyResult(connection, result, expectedUid) {
  const { db, store, auth } = connection;
  const { date, game, score, won, checks, reveals } = result;
  if (result.mode !== "daily" || result.done !== true || !validDailyResult(result))
    throw new Error("Invalid daily result.");
  const playerId = auth.currentUser?.uid;
  if (!playerId) throw new Error("A player session is required to record a result.");
  if (expectedUid && expectedUid !== playerId)
    throw new Error("The player account changed. This result stays with its original player.");
  const reference = store.doc(
    db,
    "results",
    `${playerId}_${date}_${leagueOf(result) === "general" ? "" : `${result.league}_`}${game}`,
  );
  const data = {
    playerId,
    date,
    game,
    score,
    won,
    checks,
    reveals,
    ...(leagueOf(result) !== "general" ? { league: result.league } : {}),
  };
  if (result.elapsedMs !== undefined) data.elapsedMs = result.elapsedMs;
  if (result.sharePattern !== undefined) data.sharePattern = result.sharePattern;
  const { sharePattern, ...totals } = data;
  const confirm = (snapshot) => {
    if (!snapshot.exists()) return null;
    const stored = snapshot.data();
    return Object.entries(totals).every(([key, value]) => stored[key] === value) &&
      validDailyResult(stored)
      ? stored
      : null;
  };
  try {
    await store.setDoc(reference, { ...data, completedAt: store.serverTimestamp() });
    return data;
  } catch (error) {
    if (error.code !== "permission-denied") throw error;
    // Totals remain immutable. Older completions may add their missing pattern
    // once, using the original browser's history, without rewriting the score.
    const existing = confirm(await store.getDocFromServer(reference));
    if (!existing) throw error;
    if (existing.sharePattern || !sharePattern)
      return {
        ...totals,
        ...(existing.sharePattern ? { sharePattern: existing.sharePattern } : {}),
      };
    if (auth.currentUser?.uid !== playerId)
      throw new Error("The player account changed while recording emoji history.");
    try {
      await store.updateDoc(reference, { sharePattern });
      return data;
    } catch (historyError) {
      if (historyError.code !== "permission-denied") throw historyError;
      const raced = confirm(await store.getDocFromServer(reference));
      if (!raced?.sharePattern) throw historyError;
      return { ...totals, sharePattern: raced.sharePattern };
    }
  }
}

export async function playerResultsForDate(connection, date, league = "general") {
  const { db, store, auth } = connection;
  const uid = auth.currentUser?.uid;
  if (!uid || !validDate(date)) return [];
  // Equality-only query uses Firestore's built-in index merging; no paid
  // service or extra composite index is needed for the three daily totals.
  const query = store.query(
    store.collection(db, "results"),
    store.where("playerId", "==", uid),
    store.where("date", "==", date),
    store.limit(25),
  );
  const snapshot = await store.getDocsFromServer(query);
  if (auth.currentUser?.uid !== uid)
    throw new Error("The player account changed while loading results.");
  return snapshot.docs
    .map((doc) => {
      const {
        game,
        score,
        won,
        checks,
        reveals,
        elapsedMs,
        sharePattern,
        league: storedLeague,
      } = doc.data();
      return {
        game,
        score,
        won,
        checks,
        reveals,
        ...(storedLeague ? { league: storedLeague } : {}),
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
        ...(sharePattern !== undefined ? { sharePattern } : {}),
        date,
        mode: "daily",
        done: true,
      };
    })
    .filter((r) => validDailyResult(r) && leagueOf(r) === league);
}

export async function ensurePlayerProfile(connection) {
  const { db, store, auth } = connection;
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return false;
  const reference = store.doc(db, "users", user.uid);
  const existing = await store.getDocFromServer(reference);
  if (existing.exists()) {
    if (existing.data().role !== "user")
      throw new Error("The player profile needs an owner check.");
    return true;
  }
  if (auth.currentUser?.uid !== user.uid) throw new Error("The player account changed.");
  try {
    await store.setDoc(reference, { role: "user", createdAt: store.serverTimestamp() });
  } catch (error) {
    // Another tab may have provisioned the same immutable profile.
    if (error.code !== "permission-denied") throw error;
    const saved = await store.getDocFromServer(reference);
    if (!saved.exists() || saved.data().role !== "user") throw error;
  }
  return true;
}

export async function signInPlayerWithEmail(connection, email, password, create = false) {
  const { auth, authModule } = connection;
  if (!create) return authModule.signInWithEmailAndPassword(auth, email.trim(), password);
  if (auth.currentUser?.isAnonymous) {
    const credential = authModule.EmailAuthProvider.credential(email.trim(), password);
    return authModule.linkWithCredential(auth.currentUser, credential);
  }
  return authModule.createUserWithEmailAndPassword(auth, email.trim(), password);
}

export async function signInPlayerWithGoogle(connection) {
  const { auth, authModule } = connection;
  const provider = new authModule.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  if (auth.currentUser?.isAnonymous) {
    try {
      return await authModule.linkWithPopup(auth.currentUser, provider);
    } catch (error) {
      if (
        error.code !== "auth/credential-already-in-use" &&
        error.code !== "auth/email-already-in-use"
      )
        throw error;
      const credential = authModule.GoogleAuthProvider.credentialFromError(error);
      if (!credential) throw error;
      // Existing accounts keep their own record. Never overwrite them with
      // this browser's unrelated guest history or delete the guest account.
      return authModule.signInWithCredential(auth, credential);
    }
  }
  return authModule.signInWithPopup(auth, provider);
}

export async function signOutPlayer(connection) {
  await connection.authModule.signOut(connection.auth);
  // Signing out returns to a fresh guest, rather than blocking gameplay.
  return connection.authModule.signInAnonymously(connection.auth);
}

export async function isOwner(connection, uid) {
  const { db, store } = connection;
  const snapshot = await store.getDocFromServer(store.doc(db, "owners", uid));
  return snapshot.exists() && snapshot.data().enabled === true;
}

export async function loadOwnerPuzzle(connection, date, league = "general") {
  const { db, store } = connection;
  const snapshot = await store.getDocFromServer(store.doc(db, ...puzzlePath(date, league)));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function saveOwnerPuzzle(connection, puzzle, publish, expectedRevision) {
  return persistOwnerSlate(connection, puzzle, publish, expectedRevision);
}

export async function upcomingPuzzles(connection, today, league = "general") {
  const { db, store } = connection;
  const query = store.query(
    store.collection(db, puzzlePath(today, league)[0]),
    store.orderBy(store.documentId()),
    store.startAt(today),
    store.limit(14),
  );
  const result = await store.getDocsFromServer(query);
  return result.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function publishedEditions(date) {
  const { db, store } = await connect();
  try {
    const snapshot = await store.getDocFromServer(store.doc(db, "dailyEditions", date));
    if (snapshot.exists() && snapshot.data().unlockAt.toMillis() <= Date.now())
      return LEAGUES.filter((league) => snapshot.data().published?.[league]);
  } catch {
    /* Legacy General slates have no directory entry. */
  }
  return ["general"];
}
