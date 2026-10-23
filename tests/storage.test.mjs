import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newState, guessPlayer, stateFromRecordedResult } from "../js/core.js";
import {
  loadGame,
  saveGame,
  allResults,
  resetPractice,
  readLocal,
  writeLocal,
  gameKey,
  readPreview,
  writePreview,
  getDraft,
  saveDraft,
  pendingResults,
  markResultRecorded,
  resultRecorded,
  setPlayerScope,
  getPlayerScope,
  importRecordedResults,
} from "../js/storage.js";

const sample = JSON.parse(readFileSync(new URL("../data/practice.json", import.meta.url)));
let data;
beforeEach(() => {
  setPlayerScope(null);
  data = new Map();
  globalThis.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
  };
  const session = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => session.get(key) ?? null,
    setItem: (key, value) => session.set(key, value),
  };
});

test("daily progress, streak records, and pending submissions are isolated between player accounts", () => {
  const state = guessPlayer(newState("player", sample), sample, "Jordan");
  setPlayerScope("guest-a");
  saveGame("player", sample, "daily", state);
  assert.equal(getPlayerScope(), "guest-a");
  setPlayerScope("user-b");
  assert.equal(loadGame("player", sample, "daily").done, false);
  assert.deepEqual(allResults(), []);
  assert.deepEqual(pendingResults(), []);
  saveGame("player", sample, "daily", guessPlayer(newState("player", sample), sample, "Wrong"));
  setPlayerScope("guest-a");
  assert.equal(loadGame("player", sample, "daily").done, true);
  assert.equal(pendingResults().length, 1);
  // An acknowledgement arriving after an account switch stays with its player.
  setPlayerScope("user-b");
  markResultRecorded("player", sample.date, "guest-a");
  assert.equal(resultRecorded("player", sample.date), false);
  assert.equal(resultRecorded("player", sample.date, "guest-a"), true);
});

test("first-version local saves migrate to only the first guest identity", () => {
  const state = guessPlayer(newState("player", sample), sample, "Jordan");
  saveGame("player", sample, "daily", state);
  setPlayerScope("original-guest");
  assert.equal(loadGame("player", sample, "daily").score, 5);
  assert.equal(pendingResults().length, 1);
  setPlayerScope("different-user");
  assert.equal(loadGame("player", sample, "daily").done, false);
  assert.deepEqual(allResults(), []);
});

test("remote account results are acknowledged and keep crossword assistance without creating a retry", () => {
  setPlayerScope("signed-in-user");
  importRecordedResults([
    { game: "cross", date: sample.date, score: 1, won: true, checks: 4, reveals: 2 },
  ]);
  assert.equal(resultRecorded("cross", sample.date), true);
  assert.equal(allResults()[0].reveals, 2);
  assert.deepEqual(pendingResults(), []);
  importRecordedResults([
    { game: "cross", date: sample.date, score: 1, won: true, checks: 4, reveals: 2 },
  ]);
  assert.equal(allResults().length, 1);
  const state = stateFromRecordedResult(allResults()[0], sample);
  saveGame("cross", sample, "daily", state);
  assert.deepEqual(loadGame("cross", sample, "daily"), state);
  assert.equal(allResults()[0].reveals, 2);
  assert.deepEqual(pendingResults(), []);
});

test("reload restores partial game progress; dates and modes stay isolated", () => {
  const state = guessPlayer(newState("player", sample), sample, "Wrong Player");
  saveGame("player", sample, "daily", state);
  assert.deepEqual(loadGame("player", sample, "daily"), state);
  assert.equal(loadGame("player", sample, "practice").attempts.length, 0);
  assert.equal(loadGame("player", { ...sample, date: "2026-10-21" }, "daily").attempts.length, 0);
});

test("crossword elapsed time survives reload and result queues without treating older solves as zero seconds", () => {
  setPlayerScope("timed-guest");
  const state = { ...newState("cross", sample), elapsedMs: 75432 };
  saveGame("cross", sample, "daily", state);
  assert.equal(loadGame("cross", sample, "daily").elapsedMs, 75432);
  saveGame("cross", sample, "daily", { ...state, done: true, won: true, score: 1 });
  assert.equal(pendingResults()[0].elapsedMs, 75432);
  importRecordedResults([{ ...pendingResults()[0], elapsedMs: 73000 }]);
  assert.equal(allResults()[0].elapsedMs, 73000);
  const { elapsedMs, ...legacy } = state;
  writeLocal(gameKey("cross", sample, "daily"), { ...legacy, done: true, won: true, score: 1 });
  assert.equal(loadGame("cross", sample, "daily").elapsedMs, null);
  writeLocal(gameKey("cross", sample, "daily"), legacy);
  assert.equal(loadGame("cross", sample, "daily").elapsedMs, 0);
});

test("finishing or reopening a daily game records its result once", () => {
  const state = guessPlayer(newState("player", sample), sample, "Jordan");
  saveGame("player", sample, "daily", state);
  saveGame("player", sample, "daily", state);
  assert.equal(allResults().length, 1);
  assert.equal(allResults()[0].score, 5);
});

test("practice and preview completions never write daily results", () => {
  const state = guessPlayer(newState("player", sample), sample, "Jordan");
  saveGame("player", sample, "practice", state);
  saveGame("player", sample, "preview", state);
  assert.deepEqual(allResults(), []);
  assert.deepEqual(pendingResults(), []);
});

test("completed daily results stay queued across reloads until acknowledged", () => {
  const state = guessPlayer(newState("player", sample), sample, "Jordan");
  saveGame("player", sample, "daily", state);
  assert.equal(pendingResults().length, 1);
  assert.equal(resultRecorded("player", sample.date), false);
  // Reopening a completed game must not submit a second completion.
  saveGame("player", sample, "daily", loadGame("player", sample, "daily"));
  assert.equal(pendingResults().length, 1);
  assert.equal(markResultRecorded("player", sample.date), true);
  saveGame("player", sample, "daily", state);
  assert.deepEqual(pendingResults(), []);
  assert.equal(resultRecorded("player", sample.date), true);
  assert.equal(allResults().length, 1);
});

test("queued crossword results retain assistance counts and do not affect another game's acknowledgement", () => {
  const state = {
    ...newState("cross", sample),
    done: true,
    won: true,
    score: 1,
    checks: 3,
    reveals: [0, 1],
  };
  saveGame("cross", sample, "daily", state);
  saveGame("player", sample, "daily", guessPlayer(newState("player", sample), sample, "Jordan"));
  markResultRecorded("player", sample.date);
  const [result] = pendingResults();
  assert.equal(result.game, "cross");
  assert.equal(result.checks, 3);
  assert.equal(result.reveals, 2);
  assert.equal(resultRecorded("cross", sample.date), false);
});

test("earlier local daily records can sync without turning practice into daily results", () => {
  writeLocal("results", [
    { game: "player", date: sample.date, mode: "daily", done: true, won: true, score: 5 },
    { game: "ladder", date: sample.date, mode: "practice", done: true, won: true, score: 15 },
    { game: "cross", date: "bad-date", mode: "daily", done: true, won: true, score: 1 },
  ]);
  const results = pendingResults();
  assert.equal(results.length, 1);
  assert.equal(results[0].checks, 0);
  assert.equal(results[0].reveals, 0);
});

test("practice reset clears practice only and cannot reset a live daily score", () => {
  const state = guessPlayer(newState("player", sample), sample, "Jordan");
  saveGame("player", sample, "daily", state);
  saveGame("player", sample, "practice", state);
  resetPractice(sample, "daily");
  assert.equal(loadGame("player", sample, "daily").done, true);
  resetPractice(sample, "practice");
  assert.equal(loadGame("player", sample, "practice").done, false);
  assert.equal(loadGame("player", sample, "daily").done, true);
});

test("invalid JSON and malformed saved games fall back to a fresh game", () => {
  data.set("dsg:v1:broken", "{");
  assert.equal(readLocal("broken", "fallback"), "fallback");
  writeLocal(gameKey("player", sample, "daily"), { done: false, attempts: [null] });
  assert.deepEqual(loadGame("player", sample, "daily"), newState("player", sample));
  writeLocal(gameKey("cross", sample, "daily"), { ...newState("cross", sample), letters: ["Z"] });
  assert.deepEqual(loadGame("cross", sample, "daily"), newState("cross", sample));
});

test("storage quota failures do not throw or prevent continuing in memory", () => {
  globalThis.localStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  assert.equal(writeLocal("example", {}), false);
  assert.doesNotThrow(() =>
    saveGame("player", sample, "daily", guessPlayer(newState("player", sample), sample, "Jordan")),
  );
});

test("local drafts and owner previews preserve the complete puzzle", () => {
  assert.equal(saveDraft(sample), true);
  assert.deepEqual(getDraft(sample.date), sample);
  assert.equal(writePreview(sample), true);
  assert.deepEqual(readPreview(), sample);
});
