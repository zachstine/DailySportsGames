import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dateKey, validDate, shiftDate, releaseTime, normalize, matches, validatePuzzle, buildCrossword,
  newState, guessPlayer, guessLadder, finishCrossword, streakStats, shareScore, stateFromRecordedResult } from "../js/core.js";

const sample = JSON.parse(readFileSync(new URL("../data/practice.json", import.meta.url)));
const copy = () => structuredClone(sample);

test("the shipped practice slate is valid and its crossword has shared clue numbering", () => {
  assert.deepEqual(validatePuzzle(sample), []);
  const grid = buildCrossword(sample.crossSport);
  assert.equal(grid.entries[0].number, grid.entries[2].number);
  assert.equal(grid.entries.find(e => e.answer === "RONDO").number, 3);
  assert.equal(grid.cells.filter(Boolean).length, 14);
});

test("daily date uses Eastern time, not a visitor's local time or UTC", () => {
  assert.equal(dateKey("2026-10-21T03:59:59Z"), "2026-10-20");
  assert.equal(dateKey("2026-10-21T04:00:00Z"), "2026-10-21");
  assert.equal(dateKey("2026-12-02T04:30:00Z"), "2026-12-01");
});

test("calendar validation rejects impossible and ambiguous dates", () => {
  for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "tomorrow", "", null]) assert.equal(validDate(value), false);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDate("2028-03-01", -1), "2028-02-29");
});

test("Eastern releases follow daylight saving with 23- and 25-hour days", () => {
  assert.equal(new Date(releaseTime("2026-10-20")).toISOString(), "2026-10-20T04:00:00.000Z");
  assert.equal(new Date(releaseTime("2026-12-20")).toISOString(), "2026-12-20T05:00:00.000Z");
  assert.equal(releaseTime("2026-03-09") - releaseTime("2026-03-08"), 23 * 3600000);
  assert.equal(releaseTime("2026-11-02") - releaseTime("2026-11-01"), 25 * 3600000);
});

test("accepted names ignore accents, punctuation, spaces, and case, with no substring matching", () => {
  assert.equal(normalize("  Shaquille O’Neal  "), "shaquilleoneal");
  assert.equal(matches("m. j.", sample.playerGuess), true);
  assert.equal(matches("Michael   Jordan", sample.playerGuess), true);
  assert.equal(matches("Michael", sample.playerGuess), false);
  assert.equal(matches("--", { answer: "", aliases: [""] }), false);
  assert.equal(matches("Jose", { answer: "José", aliases: [] }), true);
});

test("Player Guess scores each of the five clues correctly", () => {
  for (let clue = 1; clue <= 5; clue++) {
    let state = newState("player", sample);
    for (let i = 1; i < clue; i++) state = guessPlayer(state, sample, "Wrong Player");
    state = guessPlayer(state, sample, "Jordan");
    assert.equal(state.score, 6 - clue); assert.equal(state.won, true); assert.equal(state.done, true);
    assert.equal(guessPlayer(state, sample, "another guess"), state);
  }
});

test("Player Guess stops after five misses, including skipped clues", () => {
  let state = newState("player", sample);
  for (let i = 0; i < 5; i++) state = guessPlayer(state, sample, "", true);
  assert.equal(state.attempts.length, 5); assert.equal(state.done, true); assert.equal(state.won, false); assert.equal(state.score, 0);
  assert.equal(guessPlayer(state, sample, "Jordan"), state);
});

test("empty and punctuation-only guesses don't consume an attempt", () => {
  const state = newState("player", sample);
  assert.throws(() => guessPlayer(state, sample, "  "));
  assert.throws(() => guessLadder(newState("ladder", sample), sample, "?!"));
  assert.equal(state.attempts.length, 0);
});

test("a perfect Stat Ladder is 15 points and locks after rung five", () => {
  let state = newState("ladder", sample);
  for (const q of sample.statLadder.questions) state = guessLadder(state, sample, q.answer);
  assert.equal(state.score, 15); assert.equal(state.done, true);
  assert.equal(guessLadder(state, sample, "extra"), state);
});

test("Stat Ladder keeps climbing after misses and weights only correct rungs", () => {
  let state = newState("ladder", sample);
  state = guessLadder(state, sample, "", true);
  state = guessLadder(state, sample, "Bonds");
  state = guessLadder(state, sample, "wrong");
  state = guessLadder(state, sample, "Podsednik");
  state = guessLadder(state, sample, "wrong");
  assert.equal(state.score, 6); assert.equal(state.attempts.length, 5); assert.equal(state.done, true);
});

test("a crossword completes only when every playable letter is correct", () => {
  const grid = buildCrossword(sample.crossSport);
  let state = newState("cross", sample);
  state.letters = grid.cells.map(c => c?.letter || "");
  const wrong = structuredClone(state); wrong.letters[0] = "Z";
  assert.equal(finishCrossword(wrong, grid).done, false);
  const result = finishCrossword(state, grid);
  assert.equal(result.done, true); assert.equal(result.score, 1);
  assert.equal(finishCrossword(result, grid), result);
});

test("crossword validation rejects conflicting intersections", () => {
  const puzzle = copy(); puzzle.crossSport.entries[2].answer = "BEAR";
  assert.ok(validatePuzzle(puzzle).some(e => e.includes("conflicting letter")));
});

test("crossword validation rejects out-of-bounds and overlapping entries", () => {
  const puzzle = copy(); puzzle.crossSport.entries[0].col = 4;
  assert.ok(validatePuzzle(puzzle).some(e => e.includes("grid bounds")));
  const other = copy(); other.crossSport.entries.push({ ...other.crossSport.entries[0] });
  assert.ok(validatePuzzle(other).some(e => e.includes("overlaps")));
});

test("crossword validation rejects disconnected words and unclued touching words", () => {
  const cross = { size: 7, entries: [
    { row: 0, col: 0, direction: "across", answer: "BALL", clue: "A ball" },
    { row: 3, col: 6, direction: "down", answer: "ACE", clue: "An ace" }
  ] };
  assert.ok(buildCrossword(cross).errors.some(e => e.includes("connect")));
  const puzzle = copy(); puzzle.crossSport.entries.push({ row: 1, col: 3, direction: "across", answer: "AB", clue: "Two letters" });
  assert.ok(buildCrossword(puzzle.crossSport).errors.some(e => e.includes("Unclued")));
});

test("incomplete puzzle files report errors without throwing", () => {
  for (const puzzle of [null, [], {}, { schemaVersion: 1, statLadder: { questions: [null, null, null, null, null] }, crossSport: { size: 5, entries: [null, null] } }]) {
    assert.ok(validatePuzzle(puzzle).length > 0);
  }
  const puzzle = copy(); puzzle.statLadder.questions[0].source = "javascript:alert(1)";
  assert.ok(validatePuzzle(puzzle).some(e => e.includes("https")));
});

const record = (date, overrides = {}) => ({ date, mode: "daily", done: true, ...overrides });

test("streaks include yesterday until today's game is played, then break after a missed date", () => {
  const records = [record("2026-10-18"), record("2026-10-19")];
  assert.deepEqual(streakStats(records, "2026-10-20"), { current: 2, best: 2, played: 2 });
  assert.equal(streakStats(records, "2026-10-21").current, 0);
  assert.equal(streakStats([...records, record("2026-10-20")], "2026-10-20").current, 3);
});

test("practice, previews, and unfinished games never extend streaks; duplicate days count once", () => {
  const records = [record("2026-10-19"), record("2026-10-19"), record("2026-10-20", { mode: "practice" }), record("2026-10-20", { mode: "preview" }), record("2026-10-20", { done: false })];
  assert.deepEqual(streakStats(records, "2026-10-20"), { current: 1, best: 1, played: 1 });
});

test("completion streaks count a finished game even when the score is zero", () => {
  assert.equal(streakStats([record("2026-10-20", { won: false, score: 0 })], "2026-10-20").current, 1);
});

test("share strings contain score and blocks, with no player or stat answers", () => {
  const player = guessPlayer(newState("player", sample), sample, "Jordan");
  const text = shareScore("player", player, sample, "daily", "https://example.com/#player");
  assert.ok(text.includes("5/5")); assert.ok(text.includes("🟩⬛⬛⬛⬛")); assert.ok(text.includes(sample.date));
  assert.ok(!text.includes(sample.playerGuess.answer)); assert.ok(!text.includes("Jordan"));
  let ladder = newState("ladder", sample);
  for (const q of sample.statLadder.questions) ladder = guessLadder(ladder, sample, q.answer);
  const ladderText = shareScore("ladder", ladder, sample, "practice");
  assert.ok(ladderText.includes("Practice")); assert.ok(ladderText.includes("15/15"));
  for (const q of sample.statLadder.questions) assert.ok(!ladderText.includes(q.answer));
});

test("crossword share results disclose both checks and revealed letters", () => {
  const state = { ...newState("cross", sample), done: true, checks: 2, reveals: [0, 2] };
  const text = shareScore("cross", state, sample);
  assert.ok(text.includes("Assisted")); assert.ok(text.includes("2 checks")); assert.ok(text.includes("2 letter reveals"));
});

test("restored account totals lock completed games without inventing a guess history", () => {
  const saved = { game: "ladder", date: sample.date, score: 9, won: true, checks: 0, reveals: 0 };
  const state = stateFromRecordedResult(saved, sample);
  assert.equal(state.done, true); assert.equal(state.score, 9);
  assert.deepEqual(state.attempts, []);
  assert.equal(guessLadder(state, sample, "Anything"), state);
  const text = shareScore("ladder", state, sample);
  assert.ok(text.includes("9/15")); assert.ok(text.includes("Saved result"));
  assert.ok(!text.includes("🟩"));
  assert.throws(() => stateFromRecordedResult({ ...saved, date: "2026-10-21" }, sample), /Invalid recorded result/);
});

test("restored crossword totals share the actual assistance count without fabricating revealed cells", () => {
  const state = stateFromRecordedResult({ game: "cross", date: sample.date, score: 1, won: true, checks: 4, reveals: 3 }, sample);
  assert.deepEqual(state.reveals, []); assert.equal(state.revealCount, 3);
  assert.ok(shareScore("cross", state, sample).includes("4 checks · 3 letter reveals"));
});
