import {
  newState,
  puzzleFingerprint,
  GAMES,
  dateKey,
  validDailyResult,
  validElapsedMs,
  leagueOf,
  editionKey,
  gamesForPuzzle,
  resultLimit,
  normalize,
} from "./core.js";
import { previewEditions } from "./preview.js";
import { resultSharePattern, validSharePattern } from "./share-history.js";

const PREFIX = "dsg:v1:";
export let storageAvailable = true;
let playerScope = null;

const resultsKey = (scope) => (scope ? `player:${scope}:results` : "results");
export function getPlayerScope() {
  return playerScope;
}

export function setPlayerScope(uid) {
  playerScope = typeof uid === "string" && uid.length > 0 && uid.length <= 128 ? uid : null;
  if (!playerScope) return;
  // Bind saves from the first version to one guest, once. A different account
  // must not inherit another person's results on a shared browser.
  if (!readLocal("legacy-player")) {
    const old = readLocal("results", []);
    if (Array.isArray(old) && old.length && !readLocal(resultsKey(playerScope)))
      writeLocal(resultsKey(playerScope), old);
    writeLocal("legacy-player", playerScope);
  }
  writeLocal("last-player", playerScope);
}

export function readLocal(key, fallback = null) {
  let value;
  try {
    value = localStorage.getItem(PREFIX + key);
  } catch {
    storageAvailable = false;
    return fallback;
  }
  try {
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function writeLocal(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    storageAvailable = false;
    return false;
  }
}

export function gameKey(game, puzzle, mode, scope = playerScope) {
  // Daily saves stay attached to their date even if the owner fixes a typo.
  const player = mode === "daily" && scope ? `player:${scope}:` : "";
  const edition = editionKey(puzzle.date, leagueOf(puzzle));
  const version = mode === "daily" ? "daily" : puzzleFingerprint(puzzle);
  return `${player}${mode}:${edition}:${game}:${version}`;
}

export function loadGame(game, puzzle, mode) {
  let saved = readLocal(gameKey(game, puzzle, mode));
  if (mode === "daily" && playerScope && readLocal("legacy-player") === playerScope) {
    const legacy = readLocal(gameKey(game, puzzle, mode, null));
    if (
      !saved ||
      (saved.recordedOnly &&
        legacy?.done &&
        !legacy.recordedOnly &&
        legacy.score === saved.score &&
        legacy.won === saved.won &&
        resultSharePattern(game, legacy))
    )
      saved = legacy ?? saved;
  }
  if (
    saved &&
    typeof saved === "object" &&
    typeof saved.done === "boolean" &&
    typeof saved.won === "boolean" &&
    Number.isInteger(saved.score) &&
    saved.score >= 0 &&
    saved.score <= resultLimit(game)
  ) {
    let valid = false;
    if (saved.recordedOnly && saved.done)
      valid =
        game !== "cross" ||
        (Number.isInteger(saved.revealCount) && saved.revealCount >= 0 && saved.revealCount <= 121);
    else if (game === "cross")
      valid =
        Array.isArray(saved.letters) &&
        saved.letters.length === puzzle.crossSport.size ** 2 &&
        saved.letters.every((x) => typeof x === "string" && /^[A-Z]?$/.test(x)) &&
        Number.isInteger(saved.checks) &&
        saved.checks >= 0 &&
        Array.isArray(saved.reveals) &&
        saved.reveals.every((x) => Number.isInteger(x) && x >= 0 && x < saved.letters.length);
    else if (game === "grid")
      valid =
        Array.isArray(saved.placements) &&
        saved.placements.length === 9 &&
        saved.placements.every((x) => x === null || (Number.isInteger(x) && x >= 0 && x < 9)) &&
        new Set(saved.placements.filter((x) => x !== null)).size ===
          saved.placements.filter((x) => x !== null).length &&
        saved.score === saved.placements.filter((x) => x !== null).length &&
        (saved.selected === null ||
          (Number.isInteger(saved.selected) && saved.selected >= 0 && saved.selected < 9)) &&
        Array.isArray(saved.mistakes) &&
        saved.mistakes.length === 9 &&
        saved.mistakes.every((x) => Number.isInteger(x) && x >= 0 && x <= 100000);
    else if (game === "drill") {
      const keys = new Set(puzzle.twoMinuteDrill.answers.map((x) => normalize(x.answer)));
      valid =
        Array.isArray(saved.found) &&
        new Set(saved.found).size === saved.found.length &&
        saved.found.every((x) => keys.has(x)) &&
        saved.score === saved.found.length &&
        ((saved.startedAt === null && saved.deadline === null) ||
          (Number.isSafeInteger(saved.startedAt) && saved.deadline === saved.startedAt + 120000));
    } else
      valid =
        Array.isArray(saved.attempts) &&
        saved.attempts.length <= 5 &&
        saved.attempts.every(
          (x) =>
            x &&
            typeof x.guess === "string" &&
            typeof x.correct === "boolean" &&
            typeof x.skipped === "boolean",
        );
    if (valid)
      return game === "cross"
        ? {
            ...saved,
            elapsedMs: validElapsedMs(saved.elapsedMs) ? saved.elapsedMs : saved.done ? null : 0,
          }
        : saved;
  }
  return newState(game, puzzle);
}

export function saveGame(game, puzzle, mode, state) {
  let result = writeLocal(gameKey(game, puzzle, mode), state);
  if (state.done && mode === "daily" && !(game === "drill" && state.ranked && !state.rankPosted)) {
    const records = readLocal(resultsKey(playerScope), []);
    const list = Array.isArray(records) ? records : [];
    // One completion per game and date. Completion streaks are separate per game.
    const previous = list.find(
      (r) => r?.game === game && r.date === puzzle.date && leagueOf(r) === leagueOf(puzzle),
    );
    const rest = list.filter(
      (r) => r && !(r.game === game && r.date === puzzle.date && leagueOf(r) === leagueOf(puzzle)),
    );
    const checks =
      game === "cross"
        ? state.checks
        : game === "grid"
          ? (state.totalMistakes ?? state.mistakes.reduce((a, b) => a + b, 0))
          : 0;
    const pattern =
      resultSharePattern(game, state) ??
      (previous?.score === state.score && previous?.checks === checks && validSharePattern(previous)
        ? previous.sharePattern
        : undefined);
    const recorded = writeLocal(resultsKey(playerScope), [
      ...rest,
      {
        game,
        date: puzzle.date,
        ...(leagueOf(puzzle) !== "general" ? { league: puzzle.league } : {}),
        mode,
        done: true,
        won: state.won,
        score: state.score,
        ...(pattern ? { sharePattern: pattern } : {}),
        ...(previous?.recordedPattern ? { recordedPattern: previous.recordedPattern } : {}),
        checks,
        reveals: game === "cross" ? (state.revealCount ?? state.reveals.length) : 0,
        ...(game === "cross" && validElapsedMs(state.elapsedMs)
          ? { elapsedMs: state.elapsedMs }
          : {}),
        cloud: previous?.cloud === "recorded" ? "recorded" : "pending",
      },
    ]);
    result = result && recorded;
  }
  return result;
}

export function allResults(scope = playerScope) {
  const value = readLocal(resultsKey(scope), []);
  return Array.isArray(value)
    ? value.filter((r) => r && GAMES.includes(r.game) && typeof r.date === "string")
    : [];
}

export function pendingResults(scope = playerScope) {
  // Earlier daily saves did not have assistance counts or a cloud status.
  // Practice and preview records must never become daily submissions.
  return allResults(scope)
    .filter(
      (r) =>
        r.mode === "daily" &&
        r.done === true &&
        (r.cloud !== "recorded" || (r.sharePattern && r.sharePattern !== r.recordedPattern)),
    )
    .map((r) => ({ ...r, checks: r.checks ?? 0, reveals: r.reveals ?? 0 }))
    .filter(validDailyResult);
}

export function markResultRecorded(game, date, scope = playerScope, league = "general", pattern) {
  return writeLocal(
    resultsKey(scope),
    allResults(scope).map((r) =>
      r.game === game && r.date === date && leagueOf(r) === league
        ? {
            ...r,
            cloud: "recorded",
            ...(pattern ? { sharePattern: pattern } : {}),
            recordedPattern: pattern ?? r.sharePattern,
          }
        : r,
    ),
  );
}

export function resultRecorded(game, date, scope = playerScope, league = "general") {
  return allResults(scope).some(
    (r) =>
      r.game === game &&
      r.date === date &&
      leagueOf(r) === league &&
      r.cloud === "recorded" &&
      (!r.sharePattern || r.sharePattern === r.recordedPattern),
  );
}

export function importRecordedResults(records, scope = playerScope) {
  const list = allResults(scope);
  for (const record of records.filter(validDailyResult)) {
    const index = list.findIndex(
      (r) => r.game === record.game && r.date === record.date && leagueOf(r) === leagueOf(record),
    );
    const previous = list[index];
    const preservePattern =
      !record.sharePattern &&
      previous?.score === record.score &&
      previous?.checks === record.checks &&
      validSharePattern(previous);
    const result = {
      ...record,
      ...(preservePattern ? { sharePattern: previous.sharePattern } : {}),
      ...(record.sharePattern ? { recordedPattern: record.sharePattern } : {}),
      mode: "daily",
      done: true,
      cloud: "recorded",
    };
    if (index < 0) list.push(result);
    else list[index] = result;
  }
  return writeLocal(resultsKey(scope), list);
}

export function resetPractice(puzzle, mode) {
  if (mode === "daily") return;
  for (const game of gamesForPuzzle(puzzle))
    writeLocal(gameKey(game, puzzle, mode), newState(game, puzzle));
}

export function getDraft(date = dateKey(), league = "general") {
  return readLocal(`draft:${editionKey(date, league)}`);
}
export function saveDraft(puzzle) {
  return writeLocal(`draft:${editionKey(puzzle.date, leagueOf(puzzle))}`, puzzle);
}

export function writePreview(puzzle, context = null, editions = {}) {
  try {
    sessionStorage.setItem("dsg:preview", JSON.stringify(puzzle));
    sessionStorage.setItem("dsg:preview-context", JSON.stringify(context));
    sessionStorage.setItem(
      "dsg:preview-editions",
      JSON.stringify(context ? {} : previewEditions(puzzle, editions)),
    );
    return true;
  } catch {
    return false;
  }
}

export function readPreviewContext() {
  try {
    const value = JSON.parse(sessionStorage.getItem("dsg:preview-context") || "null");
    return value &&
      ["./create/", "./admin/submissions/"].includes(value.href) &&
      GAMES.includes(value.game)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function readPreview() {
  try {
    return JSON.parse(sessionStorage.getItem("dsg:preview") || "null");
  } catch {
    return null;
  }
}

export function readPreviewEditions() {
  if (readPreviewContext()) return {};
  try {
    const editions = JSON.parse(sessionStorage.getItem("dsg:preview-editions") || "{}");
    return previewEditions(readPreview(), editions);
  } catch {
    return previewEditions(readPreview());
  }
}
