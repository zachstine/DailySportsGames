import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  newState,
  guessPlayer,
  guessLadder,
  stateFromRecordedResult,
  mergeRecordedState,
  shareScore,
  shareSlate,
  shareBigThree,
} from "../js/core.js";
import { resultSharePattern, validSharePattern, missingShareHistory } from "../js/share-history.js";
import {
  saveGame,
  loadGame,
  setPlayerScope,
  pendingResults,
  markResultRecorded,
  resultRecorded,
  importRecordedResults,
  allResults,
  writeLocal,
  gameKey,
} from "../js/storage.js";

const puzzle = JSON.parse(readFileSync(new URL("../data/practice.json", import.meta.url)));
const record = (game, score, changes = {}) => ({
  game,
  score,
  date: puzzle.date,
  won: score > 0,
  checks: 0,
  reveals: 0,
  mode: "daily",
  done: true,
  ...changes,
});
beforeEach(() => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  setPlayerScope("pattern-player");
});

test("every Player Guess completion preserves correct, missed, skipped, and unused squares after restore", () => {
  for (let hit = 0; hit < 5; hit++) {
    for (const skipped of [false, true]) {
      let state = newState("player", puzzle);
      for (let i = 0; i < hit; i++) state = guessPlayer(state, puzzle, "Wrong", skipped);
      state = guessPlayer(state, puzzle, puzzle.playerGuess.answer);
      const sharePattern = resultSharePattern("player", state);
      const saved = record("player", state.score, { sharePattern });
      const restored = stateFromRecordedResult(saved, puzzle);
      assert.equal(shareScore("player", restored, puzzle), shareScore("player", state, puzzle));
      assert.equal(restored.recordedOnly, true);
      assert.deepEqual(restored.attempts, []);
      assert.equal(missingShareHistory("player", restored), false);
    }
  }
  const restored = stateFromRecordedResult(record("player", 4, { sharePattern: "rgbbb" }), puzzle);
  assert.match(shareScore("player", restored, puzzle), /4\/5\n🟥🟩⬛⬛⬛/);
  assert.equal(guessPlayer(restored, puzzle, "Wrong"), restored);
  for (const sharePattern of ["rrrrr", "wwwww", "rwrwr"]) {
    const restoredLoss = stateFromRecordedResult(record("player", 0, { sharePattern }), puzzle);
    assert.equal(resultSharePattern("player", restoredLoss), sharePattern);
  }
});

test("all 243 Stat Ladder outcome combinations retain the exact weighted score and emoji order", () => {
  for (let code = 0; code < 243; code++) {
    let remaining = code,
      state = newState("ladder", puzzle);
    for (const question of puzzle.statLadder.questions) {
      const choice = remaining % 3;
      remaining = Math.floor(remaining / 3);
      state = guessLadder(state, puzzle, choice === 0 ? question.answer : "Wrong", choice === 2);
    }
    const sharePattern = resultSharePattern("ladder", state);
    assert.ok(validSharePattern(record("ladder", state.score, { sharePattern })));
    const restored = stateFromRecordedResult(
      record("ladder", state.score, { sharePattern }),
      puzzle,
    );
    assert.equal(shareScore("ladder", restored, puzzle), shareScore("ladder", state, puzzle));
  }
});

test("all Matchup assistance layouts retain green and yellow squares across the nine cells", () => {
  for (let mask = 0; mask < 512; mask++) {
    const mistakes = Array.from({ length: 9 }, (_, i) => (mask & (1 << i) ? 2 : 0));
    const state = {
      ...newState("grid", puzzle),
      done: true,
      won: true,
      score: 9,
      placements: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      mistakes,
    };
    const sharePattern = resultSharePattern("grid", state);
    const checks = mistakes.reduce((a, b) => a + b, 0);
    const restored = stateFromRecordedResult(record("grid", 9, { checks, sharePattern }), puzzle);
    assert.equal(shareScore("grid", restored, puzzle), shareScore("grid", state, puzzle));
  }
});

test("emoji patterns cannot contradict totals, encode answers, or invent played games", () => {
  for (const invalid of [
    record("player", 4, { sharePattern: "gbbbb" }),
    record("player", 4, { sharePattern: "rrgbb" }),
    record("player", 4, { sharePattern: "ggbbb" }),
    record("player", 0, { sharePattern: "bbbbb" }),
    record("ladder", 8, { sharePattern: "ggggg" }),
    record("ladder", 8, { sharePattern: "Michael Jordan" }),
    record("ladder", 8, { sharePattern: "??g?g" }),
    record("grid", 9, { sharePattern: "ygggggggg" }),
    record("grid", 9, { checks: 1, sharePattern: "yyggggggg" }),
    record("grid", 9, { checks: 2, sharePattern: "ggggggggg" }),
    record("cross", 1, { sharePattern: "ggggg" }),
    record("drill", 3, { sharePattern: "ggggg" }),
  ]) {
    assert.equal(validSharePattern(invalid), false);
    assert.throws(() => stateFromRecordedResult(invalid, puzzle), /Invalid recorded result/);
  }
});

test("both combined shares preserve the individual patterns after restoration with no answers", () => {
  const states = {
    player: stateFromRecordedResult(record("player", 4, { sharePattern: "rgbbb" }), puzzle),
    ladder: stateFromRecordedResult(record("ladder", 8, { sharePattern: "rrgrg" }), puzzle),
    cross: stateFromRecordedResult(
      record("cross", 1, { checks: 2, reveals: 1, elapsedMs: 75432 }),
      puzzle,
    ),
    grid: stateFromRecordedResult(
      record("grid", 9, { checks: 1, sharePattern: "gggyggggg" }),
      puzzle,
    ),
    drill: stateFromRecordedResult(record("drill", 3), puzzle),
  };
  for (const text of [shareSlate(states, puzzle), shareBigThree(states, puzzle)]) {
    assert.match(text, /Player Guess: 4\/5\n🟥🟩⬛⬛⬛/);
    assert.match(text, /Stat Ladder: 8\/15\n🟥🟥🟩🟥🟩/);
    assert.match(text, /CrossSport: Complete · 01:15\n🟨 Assisted/);
    assert.ok(!text.includes("❔"));
    assert.ok(!text.includes(puzzle.playerGuess.answer));
  }
  assert.match(shareSlate(states, puzzle), /🟩🟩🟩\n🟨🟩🟩\n🟩🟩🟩/);
});

test("old totals show known outcomes and explicitly mark missing history without guessing reds or skips", () => {
  const player = stateFromRecordedResult(record("player", 4), puzzle);
  assert.match(shareScore("player", player, puzzle), /4\/5\n❔🟩⬛⬛⬛/);
  assert.equal(missingShareHistory("player", player), true);
  const perfect = stateFromRecordedResult(record("player", 5), puzzle);
  assert.match(shareScore("player", perfect, puzzle), /🟩⬛⬛⬛⬛/);
  assert.equal(missingShareHistory("player", perfect), false);
  const ladder = stateFromRecordedResult(record("ladder", 8), puzzle);
  assert.match(shareScore("ladder", ladder, puzzle), /❔❔❔❔❔/);
  const grid = stateFromRecordedResult(record("grid", 9), puzzle);
  assert.match(shareScore("grid", grid, puzzle), /🟩🟩🟩\n🟩🟩🟩\n🟩🟩🟩/);
  const text = shareBigThree(
    { player, ladder, cross: stateFromRecordedResult(record("cross", 1), puzzle) },
    puzzle,
  );
  assert.equal(text.split("Earlier guess history unavailable").length - 1, 1);
});

test("reopening older recorded totals queues a one-time history backfill and cloud imports preserve it", () => {
  let state = guessPlayer(newState("player", puzzle), puzzle, "Wrong");
  state = guessPlayer(state, puzzle, puzzle.playerGuess.answer);
  importRecordedResults([record("player", 4)]);
  saveGame("player", puzzle, "daily", state);
  assert.equal(pendingResults()[0].sharePattern, "rgbbb");
  assert.equal(resultRecorded("player", puzzle.date), false);
  importRecordedResults([record("player", 4)]);
  assert.equal(pendingResults()[0].sharePattern, "rgbbb");
  const merged = mergeRecordedState(loadGame("player", puzzle, "daily"), allResults()[0], puzzle);
  assert.deepEqual(merged.attempts, state.attempts);
  markResultRecorded("player", puzzle.date);
  assert.deepEqual(pendingResults(), []);
  assert.equal(resultRecorded("player", puzzle.date), true);
  importRecordedResults([record("player", 4, { sharePattern: "rgbbb" })]);
  saveGame("player", puzzle, "daily", stateFromRecordedResult(allResults()[0], puzzle));
  assert.deepEqual(pendingResults(), []);
  assert.match(shareScore("player", loadGame("player", puzzle, "daily"), puzzle), /🟥🟩⬛⬛⬛/);
});

test("a cloud history arriving later hydrates score-only state and resolves conflicting device outcomes", () => {
  const legacy = stateFromRecordedResult(record("player", 4), puzzle);
  const cloud = record("player", 4, { sharePattern: "wgbbb" });
  assert.match(
    shareScore("player", mergeRecordedState(legacy, cloud, puzzle), puzzle),
    /⬜🟩⬛⬛⬛/,
  );
  let local = guessPlayer(newState("player", puzzle), puzzle, "Wrong");
  local = guessPlayer(local, puzzle, puzzle.playerGuess.answer);
  const merged = mergeRecordedState(local, cloud, puzzle);
  assert.equal(merged.recordedOnly, true);
  assert.equal(merged.score, 4);
  assert.match(shareScore("player", merged, puzzle), /⬜🟩⬛⬛⬛/);
});

test("legacy local history is recovered only for its bound player and matching score", () => {
  let state = guessPlayer(newState("player", puzzle), puzzle, "Wrong");
  state = guessPlayer(state, puzzle, puzzle.playerGuess.answer);
  writeLocal("legacy-player", "pattern-player");
  writeLocal(gameKey("player", puzzle, "daily", null), state);
  writeLocal(
    gameKey("player", puzzle, "daily"),
    stateFromRecordedResult(record("player", 4), puzzle),
  );
  assert.deepEqual(loadGame("player", puzzle, "daily").attempts, state.attempts);
  setPlayerScope("different-player");
  writeLocal(
    gameKey("player", puzzle, "daily"),
    stateFromRecordedResult(record("player", 4), puzzle),
  );
  assert.equal(loadGame("player", puzzle, "daily").recordedOnly, true);
  setPlayerScope("pattern-player");
  writeLocal(
    gameKey("player", puzzle, "daily"),
    stateFromRecordedResult(record("player", 3), puzzle),
  );
  assert.equal(loadGame("player", puzzle, "daily").recordedOnly, true);
});
