import { GAME_FIELDS, GAMES, validDate, releaseTime, validatePuzzle } from "./core.js";
import { creatorName, gameEnvelope, validateGameImport, validateCredits, mergeGameIntoSlate, SUBMISSION_STATUSES } from "./puzzles.js";

const DAY_MS = 86400000;
const COOLDOWN_MS = 60000;
const MAX_PER_DAY = 5;
const timestamp = value => value?.toMillis?.() ?? 0;
const fail = (message, code) => Object.assign(new Error(message), { code });
const slateData = data => data ? { ...data.puzzle, credits: data.credits || {} } : null;
const metadata = (store, uid, revision) => ({ updatedAt: store.serverTimestamp(), updatedBy: uid, revision });

export async function submitCommunityPuzzle(connection, envelope) {
  const errors = validateGameImport(envelope);
  if (errors.length) throw new Error(errors.join("\n"));
  const name = creatorName(envelope.creatorCredit, true);
  const { db, store, auth } = connection;
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("A guest session couldn't connect. Please try again.");
  const reference = store.doc(store.collection(db, "submissions"));
  const limitRef = store.doc(db, "submissionLimits", uid);
  await store.runTransaction(db, async transaction => {
    const snapshot = await transaction.get(limitRef);
    const old = snapshot.exists() ? snapshot.data() : null;
    const now = Date.now();
    const reset = !old || now - timestamp(old.windowStartedAt) >= DAY_MS;
    if (old && now - timestamp(old.lastSubmittedAt) < COOLDOWN_MS) throw fail("Please wait one minute between submissions. Your draft is still saved.", "submission/rate-limited");
    if (!reset && old.count >= MAX_PER_DAY) throw fail("You've sent five suggestions in 24 hours. Your next draft is saved here for later.", "submission/rate-limited");
    if (auth.currentUser?.uid !== uid) throw new Error("Your player session changed. Please submit again.");
    transaction.set(reference, {
      schemaVersion: 1, game: envelope.game, proposedName: name,
      puzzleJson: JSON.stringify(envelope.data), submittedBy: uid,
      createdAt: store.serverTimestamp(), status: "pending", revision: 1
    });
    transaction.set(limitRef, {
      windowStartedAt: reset ? store.serverTimestamp() : old.windowStartedAt,
      lastSubmittedAt: store.serverTimestamp(), count: reset ? 1 : old.count + 1,
      lastSubmissionId: reference.id
    });
  });
  return reference.id;
}

export async function listSubmissions(connection, cursor = null) {
  const { db, store } = connection;
  const parts = [store.orderBy("createdAt", "desc"), ...(cursor ? [store.startAfter(cursor)] : []), store.limit(50)];
  const result = await store.getDocsFromServer(store.query(store.collection(db, "submissions"), ...parts));
  return { items: result.docs.map(doc => ({ id: doc.id, ...doc.data() })), cursor: result.docs.at(-1) || null, more: result.docs.length === 50 };
}
export async function loadSubmission(connection, id) {
  const { db, store } = connection;
  const snapshot = await store.getDocFromServer(store.doc(db, "submissions", id));
  if (!snapshot.exists()) throw new Error("This submission wasn't found.");
  return { id: snapshot.id, ...snapshot.data() };
}
export function submissionEnvelope(submission, approvedOnly = false) {
  if (approvedOnly && !["approved", "published"].includes(submission.status)) throw new Error("Approve this puzzle before exporting it.");
  const json = submission.reviewedPuzzleJson ?? submission.puzzleJson;
  let data;
  try { data = JSON.parse(json); } catch { throw new Error("The submitted puzzle isn't valid JSON. Reject it or replace its content before approval."); }
  return gameEnvelope(submission.game, data, submission.reviewedName ?? submission.proposedName, submission.id);
}

function checkRevision(data, expected) {
  if ((data?.revision ?? 0) !== expected) throw new Error("This date changed in another tab. Load the date again before saving or confirming a replacement.");
}
function checkNotLive(data) {
  if (data?.published && timestamp(data.unlockAt) <= Date.now()) throw new Error("This slate is already live. Its puzzles are locked; choose a future date. Creator names can still be edited separately.");
}
async function readLinkedSubmissions(transaction, db, store, credits) {
  const result = [];
  for (const [game, credit] of Object.entries(credits)) {
    if (!credit.submissionId) continue;
    const reference = store.doc(db, "submissions", credit.submissionId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists() || snapshot.data().game !== game || !["approved", "published"].includes(snapshot.data().status)) throw new Error("The linked submission must be approved before importing or publishing it.");
    result.push({ reference, data: snapshot.data(), game, name: credit.displayName });
  }
  return result;
}
function markPublished(transaction, store, linked, date, uid) {
  for (const { reference, data, name } of linked) {
    const dates = [...new Set([...(data.publishedDates || []), date])];
    if (dates.length > 30) throw new Error("This suggestion has already been used on 30 dates. Create a new suggestion to use it again.");
    transaction.update(reference, {
      status: "published", publishedDates: dates, publishedAt: store.serverTimestamp(),
      reviewedName: name, reviewedBy: uid, reviewedAt: store.serverTimestamp(), revision: data.revision + 1
    });
  }
}

export async function importOwnerGame(connection, date, envelope, expectedRevision, replace = false) {
  if (!validDate(date)) throw new Error("Choose a valid release date.");
  const errors = validateGameImport(envelope);
  if (errors.length) throw new Error(errors.join("\n"));
  const { db, store, auth } = connection;
  const reference = store.doc(db, "dailyPuzzles", date);
  return store.runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const old = snapshot.exists() ? snapshot.data() : null;
    checkRevision(old, expectedRevision); checkNotLive(old);
    const field = GAME_FIELDS[envelope.game];
    if (old?.puzzle?.[field] && Object.keys(old.puzzle[field]).length && !replace) throw fail("Confirm replacing this game's existing puzzle first.", "import/overwrite-required");
    const merged = mergeGameIntoSlate(slateData(old), envelope, date);
    const credit = merged.credits[envelope.game];
    const linked = await readLinkedSubmissions(transaction, db, store, credit ? { [envelope.game]: credit } : {});
    const revision = (old?.revision ?? 0) + 1;
    if (old) {
      // Field-specific updates are essential: importing a single game cannot
      // replace another game, its credit, or the day's publication status.
      transaction.update(reference, {
        [`puzzle.${field}`]: structuredClone(envelope.data),
        [`credits.${envelope.game}`]: credit || store.deleteField(),
        ...metadata(store, auth.currentUser.uid, revision)
      });
    } else {
      const { credits, ...puzzle } = merged;
      transaction.set(reference, { date, puzzle, credits, published: false,
        unlockAt: store.Timestamp.fromMillis(releaseTime(date)), ...metadata(store, auth.currentUser.uid, revision) });
    }
    if (old?.published) markPublished(transaction, store, linked, date, auth.currentUser.uid);
    return { slate: merged, revision, published: old?.published || false };
  });
}

export async function persistOwnerSlate(connection, puzzle, publish, expectedRevision) {
  const errors = [...validatePuzzle(puzzle), ...validateCredits(puzzle.credits)];
  if (errors.length) throw new Error(errors.join("\n"));
  const { db, store, auth } = connection;
  const reference = store.doc(db, "dailyPuzzles", puzzle.date);
  return store.runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const old = snapshot.exists() ? snapshot.data() : null;
    checkRevision(old, expectedRevision); checkNotLive(old);
    const { credits = {}, ...content } = puzzle;
    const linked = await readLinkedSubmissions(transaction, db, store, credits);
    const revision = (old?.revision ?? 0) + 1;
    const data = { date: puzzle.date, puzzle: content, credits, published: publish,
      unlockAt: store.Timestamp.fromMillis(releaseTime(puzzle.date)), ...metadata(store, auth.currentUser.uid, revision) };
    if (old) transaction.update(reference, data); else transaction.set(reference, data);
    if (publish) markPublished(transaction, store, linked, puzzle.date, auth.currentUser.uid);
    return revision;
  });
}

async function readCreditDates(transaction, db, store, submission, id) {
  const targets = [];
  for (const date of submission.publishedDates || []) {
    const reference = store.doc(db, "dailyPuzzles", date);
    const snapshot = await transaction.get(reference);
    if (snapshot.exists() && snapshot.data().credits?.[submission.game]?.submissionId === id) targets.push({ reference, data: snapshot.data() });
  }
  return targets;
}
export async function saveSubmissionReview(connection, submission, data, name, status) {
  const envelope = gameEnvelope(submission.game, data, creatorName(name, true));
  if (!SUBMISSION_STATUSES.includes(status)) throw new Error("Choose a valid review status.");
  const { db, store, auth } = connection;
  const reference = store.doc(db, "submissions", submission.id);
  return store.runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists() || snapshot.data().revision !== submission.revision) throw new Error("This suggestion changed in another tab. Reopen it before saving.");
    const old = snapshot.data();
    if (old.status === "published" && status !== "published") throw new Error("A published suggestion keeps its publication record. Edit its credit or export a revised puzzle.");
    const targets = await readCreditDates(transaction, db, store, old, submission.id);
    const update = { reviewedPuzzleJson: JSON.stringify(envelope.data), reviewedName: envelope.creatorCredit,
      status, reviewedBy: auth.currentUser.uid, reviewedAt: store.serverTimestamp(), revision: old.revision + 1 };
    transaction.update(reference, update);
    if (old.reviewedName !== name) for (const target of targets) {
      // A name correction never changes a released puzzle's answer or clues.
      transaction.update(target.reference, { [`credits.${old.game}.displayName`]: envelope.creatorCredit,
        ...metadata(store, auth.currentUser.uid, target.data.revision + 1) });
    }
    return { ...old, ...update, id: submission.id };
  });
}
export async function rejectSubmission(connection, submission) {
  const { db, store, auth } = connection;
  const reference = store.doc(db, "submissions", submission.id);
  await store.runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists() || snapshot.data().revision !== submission.revision) throw new Error("This suggestion changed. Reopen it first.");
    if (snapshot.data().status === "published") throw new Error("This suggestion is already published.");
    transaction.update(reference, { status: "rejected", reviewedBy: auth.currentUser.uid, reviewedAt: store.serverTimestamp(), revision: submission.revision + 1 });
  });
}
export async function saveOwnerCredits(connection, date, credits, expectedRevision) {
  const errors = validateCredits(credits);
  if (errors.length) throw new Error(errors.join("\n"));
  const { db, store, auth } = connection;
  const reference = store.doc(db, "dailyPuzzles", date);
  return store.runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error("Save or import a slate for this date first.");
    const old = snapshot.data(); checkRevision(old, expectedRevision);
    const linked = await readLinkedSubmissions(transaction, db, store, credits);
    const changes = [];
    for (const link of linked) if (link.data.reviewedName !== link.name) {
      const targets = await readCreditDates(transaction, db, store, { ...link.data, game: link.game }, link.reference.id);
      changes.push({ ...link, targets });
    }
    const patches = new Map([[date, { reference, data: old, credits: structuredClone(credits) }]]);
    for (const change of changes) for (const target of change.targets) {
      if (target.reference.id === date) continue;
      const patch = patches.get(target.reference.id) || { ...target, credits: structuredClone(target.data.credits || {}) };
      patch.credits[change.game].displayName = change.name; patches.set(target.reference.id, patch);
    }
    for (const patch of patches.values()) transaction.update(patch.reference, { credits: patch.credits, ...metadata(store, auth.currentUser.uid, patch.data.revision + 1) });
    for (const change of changes) transaction.update(change.reference, { reviewedName: change.name, reviewedBy: auth.currentUser.uid, reviewedAt: store.serverTimestamp(), revision: change.data.revision + 1 });
    return old.revision + 1;
  });
}
