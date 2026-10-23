import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BASE_GAMES,
  GAMES,
  GAME_FIELDS,
  validateGame,
  validatePuzzle,
  gamesForPuzzle,
  newState,
  normalize,
  shareSlate,
  shareScore,
  validDailyResult,
  gameScoreLabel,
  stateFromRecordedResult,
} from "../js/core.js";
import {
  blankSlate,
  editorSlate,
  gameEnvelope,
  mergeGameIntoSlate,
  exportGameFromSlate,
} from "../js/puzzles.js";
import {
  placeGrid,
  gridBank,
  startDrill,
  finishDrill,
  guessDrill,
  parseDrillAnswers,
} from "../js/new-games.js";
import {
  gameKey,
  loadGame,
  saveGame,
  allResults,
  setPlayerScope,
  saveDraft,
  getDraft,
  markResultRecorded,
  resultRecorded,
  importRecordedResults,
} from "../js/storage.js";
import { writeDailyResult } from "../js/firebase.js";

const sample = JSON.parse(readFileSync(new URL("../data/practice.json", import.meta.url)));
const legacy = () => {
  const result = structuredClone(sample);
  delete result.gridIron;
  delete result.twoMinuteDrill;
  return result;
};
const nfl = () => ({ ...legacy(), league: "nfl" });
const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => memory.set(k, v),
};

test("new General slates have five games with Drill last; legacy and league slates keep three", () => {
  assert.deepEqual(gamesForPuzzle(sample), GAMES);
  assert.deepEqual(gamesForPuzzle(legacy()), BASE_GAMES);
  assert.deepEqual(gamesForPuzzle(nfl()), BASE_GAMES);
  assert.ok(blankSlate(sample.date).twoMinuteDrill);
  assert.equal(blankSlate(sample.date, "nfl").gridIron, undefined);
  assert.equal(editorSlate(legacy()).gridIron, undefined);
  assert.deepEqual(validatePuzzle(sample), []);
  assert.deepEqual(validatePuzzle(nfl()), []);
  assert.ok(validatePuzzle({ ...sample, league: "nfl" }).length);
});

test("grid requires nine unique names and a complete one-to-one placement", () => {
  const duplicate = structuredClone(sample.gridIron);
  duplicate.names[1] = duplicate.names[0];
  assert.ok(validateGame("grid", duplicate).length);
  const reused = structuredClone(sample.gridIron);
  reused.cells[1].answer = reused.cells[0].answer;
  assert.ok(validateGame("grid", reused).length);
  assert.ok(validateGame("grid", { names: [], cells: [] }).length);
  assert.deepEqual(
    gridBank(sample)
      .slice()
      .sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.deepEqual(gridBank(sample), gridBank(structuredClone(sample)));
});

test("grid misses remain playable, correct matches lock, and completion shares a three-row emoji grid", () => {
  let state = newState("grid", sample);
  state = placeGrid(state, sample, 1, 0);
  assert.equal(state.mistakes[1], 1);
  assert.equal(state.score, 0);
  state = placeGrid(state, sample, 0, 0);
  assert.equal(state.score, 1);
  assert.deepEqual(placeGrid(state, sample, 1, 0), state);
  for (let i = 1; i < 9; i++) state = placeGrid(state, sample, i, i);
  assert.equal(state.done, true);
  assert.equal(state.score, 9);
  assert.equal(gameScoreLabel("grid", state), "9/9");
  const text = shareScore("grid", state, sample);
  assert.match(text, /🟩🟨🟩\n🟩🟩🟩\n🟩🟩🟩/);
  for (const name of sample.gridIron.names) assert.ok(!text.includes(name));
  assert.deepEqual(placeGrid(state, sample, 2, 4), state);
});

test("Drill CSV supports aliases and rejects ambiguous, empty, or oversized answer banks", () => {
  const answers = parseDrillAnswers(" Patrick Mahomes | Mahomes, Wes Welker | Welker, ");
  assert.deepEqual(answers, [
    { answer: "Patrick Mahomes", aliases: ["Mahomes"] },
    { answer: "Wes Welker", aliases: ["Welker"] },
  ]);
  assert.deepEqual(validateGame("drill", { question: "Name players", answers }), []);
  assert.ok(
    validateGame("drill", {
      question: "Name players",
      answers: [...answers, { answer: "Mahomes", aliases: [] }],
    }).length,
  );
  assert.ok(validateGame("drill", { question: "Name players", answers: [] }).length);
  assert.ok(
    validateGame("drill", { question: "Name players", answers: Array(501).fill(answers[0]) })
      .length,
  );
  assert.doesNotThrow(() => validateGame("drill", { question: "Test", answers: [null] }));
});

test("Drill has unlimited misses, one point per unique accepted answer, and a strict 120-second deadline", () => {
  let state = newState("drill", sample);
  assert.throws(() => guessDrill(state, sample, "Eagles", 0), /Start the clock/);
  state = startDrill(state, 1000);
  assert.equal(state.deadline, 121000);
  assert.deepEqual(startDrill(state, 5000), state);
  for (let i = 0; i < 50; i++) state = guessDrill(state, sample, "Cowboys", 2000 + i).state;
  assert.equal(state.misses, 50);
  assert.equal(state.done, false);
  state = guessDrill(state, sample, "eagles", 5000).state;
  assert.equal(guessDrill(state, sample, "Philadelphia Eagles", 6000).outcome, "duplicate");
  state = guessDrill(state, sample, "RAVENS", 120999).state;
  assert.equal(state.score, 2);
  const expired = guessDrill(state, sample, "Falcons", 121000);
  assert.equal(expired.state.score, 2);
  assert.equal(expired.state.done, true);
  assert.equal(finishDrill(state, 500000).score, 2);
});

test("Drill can finish when its full bank is found, and its shared score never reveals answers", () => {
  let state = startDrill(newState("drill", sample), 1000);
  for (const answer of sample.twoMinuteDrill.answers)
    state = guessDrill(state, sample, answer.answer, 2000).state;
  assert.equal(state.done, true);
  assert.equal(state.score, 5);
  const text = shareScore("drill", state, sample);
  assert.match(text, /5 answers/);
  assert.match(text, /⏱️ 2:00/);
  for (const answer of sample.twoMinuteDrill.answers) assert.ok(!text.includes(answer.answer));
});

test("daily league keys, drafts, completion records, acknowledgements, and restored scores are isolated", () => {
  memory.clear();
  setPlayerScope("edition-player");
  assert.match(
    gameKey("player", sample, "daily"),
    new RegExp(`daily:${sample.date}:player:daily$`),
  );
  assert.notEqual(gameKey("player", sample, "daily"), gameKey("player", nfl(), "daily"));
  saveGame("player", sample, "daily", {
    ...newState("player", sample),
    done: true,
    won: true,
    score: 5,
  });
  saveGame("player", nfl(), "daily", {
    ...newState("player", nfl()),
    done: true,
    won: true,
    score: 2,
  });
  assert.equal(allResults().length, 2);
  markResultRecorded("player", sample.date, "edition-player", "nfl");
  assert.equal(resultRecorded("player", sample.date), false);
  assert.equal(resultRecorded("player", sample.date, "edition-player", "nfl"), true);
  saveDraft(sample);
  saveDraft({ ...nfl(), title: "NFL draft" });
  assert.equal(getDraft(sample.date).title, sample.title);
  assert.equal(getDraft(sample.date, "nfl").title, "NFL draft");
  const record = {
    game: "ladder",
    date: sample.date,
    league: "nfl",
    score: 8,
    won: true,
    checks: 0,
    reveals: 0,
  };
  importRecordedResults([record]);
  assert.equal(allResults().length, 3);
  assert.equal(stateFromRecordedResult(record, nfl()).score, 8);
  assert.throws(() => stateFromRecordedResult(record, sample), /Invalid recorded/);
});

test("new game progress restores through reloads, including a Drill whose deadline has elapsed", () => {
  memory.clear();
  setPlayerScope("new-game-player");
  const grid = placeGrid(newState("grid", sample), sample, 0, 0);
  saveGame("grid", sample, "daily", grid);
  assert.deepEqual(loadGame("grid", sample, "daily"), grid);
  const drill = guessDrill(
    startDrill(newState("drill", sample), 1000),
    sample,
    "Eagles",
    2000,
  ).state;
  saveGame("drill", sample, "daily", drill);
  const resumed = loadGame("drill", sample, "daily");
  assert.equal(resumed.deadline, 121000);
  assert.equal(finishDrill(resumed, 130000).score, 1);
});

test("five-game combined sharing retains every game's own blocks and labels league editions", () => {
  const states = Object.fromEntries(
    GAMES.map((game) => [
      game,
      { ...newState(game, sample), done: true, won: true, score: game === "grid" ? 9 : 1 },
    ]),
  );
  states.player.attempts = [{ correct: false }, { correct: false }, { correct: true }];
  states.grid.placements = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const text = shareSlate(states, sample);
  assert.match(text, /🟥🟥🟩⬛⬛/);
  assert.ok(text.indexOf("The Matchup") < text.indexOf("Two Minute Drill"));
  assert.match(shareSlate(states, nfl()), /· NFL/);
  assert.ok(!shareSlate(states, nfl()).includes("Two Minute Drill"));
  assert.throws(
    () => shareSlate({ ...states, drill: { ...states.drill, done: false } }, sample),
    /Finish all games/,
  );
});

test("single-game imports and exports preserve the selected league and reject an explicit mismatch", () => {
  const value = exportGameFromSlate(nfl(), "player");
  assert.equal(value.league, "nfl");
  assert.throws(() => mergeGameIntoSlate(sample, value, sample.date), /different league/);
  const merged = mergeGameIntoSlate(nfl(), gameEnvelope("ladder", sample.statLadder), sample.date);
  assert.equal(merged.league, "nfl");
  assert.deepEqual(merged.playerGuess, nfl().playerGuess);
  assert.throws(
    () => mergeGameIntoSlate(nfl(), gameEnvelope("drill", sample.twoMinuteDrill), sample.date),
    /different league/,
  );
});

test("new and league results use distinct database IDs and valid limits without exposing guesses", async () => {
  const writes = [];
  const connection = {
    db: {},
    auth: { currentUser: { uid: "user-a" } },
    store: {
      doc: (_db, c, id) => `${c}/${id}`,
      setDoc: async (path, data) => writes.push({ path, data }),
      serverTimestamp: () => "now",
    },
  };
  const record = {
    game: "ladder",
    date: sample.date,
    league: "nfl",
    mode: "daily",
    done: true,
    won: true,
    score: 8,
    checks: 0,
    reveals: 0,
  };
  await writeDailyResult(connection, record);
  assert.equal(writes[0].path, `results/user-a_${sample.date}_nfl_ladder`);
  assert.equal(writes[0].data.league, "nfl");
  assert.equal(writes[0].data.guesses, undefined);
  assert.ok(validDailyResult({ ...record, league: undefined, game: "grid", score: 9, checks: 3 }));
  assert.ok(
    validDailyResult({ ...record, league: undefined, game: "drill", score: 0, won: false }),
  );
  assert.equal(validDailyResult({ ...record, game: "drill", score: 1 }), false);
});

test("ranked completion waits for its verified final total before queuing an immutable private result", () => {
  memory.clear();
  setPlayerScope("ranked-final-player");
  const state = {
    ...startDrill(newState("drill", sample), 1000),
    found: ["philadelphiaeagles"],
    score: 1,
    done: true,
    won: true,
    ranked: true,
  };
  saveGame("drill", sample, "daily", state);
  assert.equal(allResults().length, 0);
  assert.equal(loadGame("drill", sample, "daily").score, 1);
  saveGame("drill", sample, "daily", {
    ...state,
    rankPosted: true,
    found: ["philadelphiaeagles", "baltimoreravens"],
    score: 2,
  });
  assert.equal(allResults().length, 1);
  assert.equal(allResults()[0].score, 2);
});
