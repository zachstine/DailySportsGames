import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newState, guessPlayer } from "../js/core.js";
import { loadGame, saveGame, allResults, resetPractice, readLocal, writeLocal, gameKey, readPreview, writePreview, getDraft, saveDraft } from "../js/storage.js";

const sample = JSON.parse(readFileSync(new URL("../data/practice.json", import.meta.url)));
let data;
beforeEach(() => {
  data = new Map();
  globalThis.localStorage = {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, value)
  };
  const session = new Map();
  globalThis.sessionStorage = {
    getItem: key => session.get(key) ?? null,
    setItem: (key, value) => session.set(key, value)
  };
});

test("reload restores partial game progress; dates and modes stay isolated", () => {
  const state = guessPlayer(newState("player", sample), sample, "Wrong Player");
  saveGame("player", sample, "daily", state);
  assert.deepEqual(loadGame("player", sample, "daily"), state);
  assert.equal(loadGame("player", sample, "practice").attempts.length, 0);
  assert.equal(loadGame("player", { ...sample, date: "2026-10-21" }, "daily").attempts.length, 0);
});

test("finishing or reopening a daily game records its result once", () => {
  const state = guessPlayer(newState("player", sample), sample, "Jordan");
  saveGame("player", sample, "daily", state); saveGame("player", sample, "daily", state);
  assert.equal(allResults().length, 1); assert.equal(allResults()[0].score, 5);
});

test("practice and preview completions never write daily results", () => {
  const state = guessPlayer(newState("player", sample), sample, "Jordan");
  saveGame("player", sample, "practice", state); saveGame("player", sample, "preview", state);
  assert.deepEqual(allResults(), []);
});

test("practice reset clears practice only and cannot reset a live daily score", () => {
  const state = guessPlayer(newState("player", sample), sample, "Jordan");
  saveGame("player", sample, "daily", state); saveGame("player", sample, "practice", state);
  resetPractice(sample, "daily"); assert.equal(loadGame("player", sample, "daily").done, true);
  resetPractice(sample, "practice"); assert.equal(loadGame("player", sample, "practice").done, false);
  assert.equal(loadGame("player", sample, "daily").done, true);
});

test("invalid JSON and malformed saved games fall back to a fresh game", () => {
  data.set("dsg:v1:broken", "{"); assert.equal(readLocal("broken", "fallback"), "fallback");
  writeLocal(gameKey("player", sample, "daily"), { done: false, attempts: [null] });
  assert.deepEqual(loadGame("player", sample, "daily"), newState("player", sample));
  writeLocal(gameKey("cross", sample, "daily"), { ...newState("cross", sample), letters: ["Z"] });
  assert.deepEqual(loadGame("cross", sample, "daily"), newState("cross", sample));
});

test("storage quota failures do not throw or prevent continuing in memory", () => {
  globalThis.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(writeLocal("example", {}), false);
  assert.doesNotThrow(() => saveGame("player", sample, "daily", guessPlayer(newState("player", sample), sample, "Jordan")));
});

test("local drafts and owner previews preserve the complete puzzle", () => {
  assert.equal(saveDraft(sample), true); assert.deepEqual(getDraft(sample.date), sample);
  assert.equal(writePreview(sample), true); assert.deepEqual(readPreview(), sample);
});
