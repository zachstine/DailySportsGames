import { newState, puzzleFingerprint, GAMES, dateKey } from "./core.js";

const PREFIX = "dsg:v1:";
export let storageAvailable = true;

export function readLocal(key, fallback = null) {
  let value;
  try {
    value = localStorage.getItem(PREFIX + key);
  } catch { storageAvailable = false; return fallback; }
  try { return value === null ? fallback : JSON.parse(value); }
  catch { return fallback; }
}

export function writeLocal(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
  catch { storageAvailable = false; return false; }
}

export function gameKey(game, puzzle, mode) {
  // Daily saves stay attached to their date even if the owner fixes a typo.
  return `${mode}:${puzzle.date}:${game}:${mode === "daily" ? "daily" : puzzleFingerprint(puzzle)}`;
}

export function loadGame(game, puzzle, mode) {
  const saved = readLocal(gameKey(game, puzzle, mode));
  if (saved && typeof saved === "object" && typeof saved.done === "boolean" && typeof saved.won === "boolean" &&
    Number.isInteger(saved.score) && saved.score >= 0 && saved.score <= (game === "ladder" ? 15 : game === "player" ? 5 : 1) &&
    (game === "cross" ? Array.isArray(saved.letters) && saved.letters.length === puzzle.crossSport.size ** 2 &&
      saved.letters.every(x => typeof x === "string" && /^[A-Z]?$/.test(x)) &&
      Number.isInteger(saved.checks) && saved.checks >= 0 && Array.isArray(saved.reveals) &&
      saved.reveals.every(x => Number.isInteger(x) && x >= 0 && x < saved.letters.length) :
      Array.isArray(saved.attempts) && saved.attempts.length <= 5 &&
      saved.attempts.every(x => x && typeof x.guess === "string" && typeof x.correct === "boolean" && typeof x.skipped === "boolean"))) return saved;
  return newState(game, puzzle);
}

export function saveGame(game, puzzle, mode, state) {
  const result = writeLocal(gameKey(game, puzzle, mode), state);
  if (state.done && mode === "daily") {
    const records = readLocal("results", []);
    const list = Array.isArray(records) ? records : [];
    // One completion per game and date. Completion streaks are separate per game.
    const rest = list.filter(r => r && !(r.game === game && r.date === puzzle.date));
    writeLocal("results", [...rest, { game, date: puzzle.date, mode, done: true, won: state.won, score: state.score }]);
  }
  return result;
}

export function allResults() {
  const value = readLocal("results", []);
  return Array.isArray(value) ? value.filter(r => r && GAMES.includes(r.game) && typeof r.date === "string") : [];
}

export function resetPractice(puzzle, mode) {
  if (mode === "daily") return;
  for (const game of GAMES) writeLocal(gameKey(game, puzzle, mode), newState(game, puzzle));
}

export function getDraft(date = dateKey()) { return readLocal(`draft:${date}`); }
export function saveDraft(puzzle) { return writeLocal(`draft:${puzzle.date}`, puzzle); }

export function writePreview(puzzle) {
  try { sessionStorage.setItem("dsg:preview", JSON.stringify(puzzle)); return true; }
  catch { return false; }
}

export function readPreview() {
  try { return JSON.parse(sessionStorage.getItem("dsg:preview") || "null"); }
  catch { return null; }
}
