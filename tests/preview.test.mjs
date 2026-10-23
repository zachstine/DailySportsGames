import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectPreviewEditions, previewEditions } from "../js/preview.js";

const sample = JSON.parse(readFileSync(new URL("../data/practice.json", import.meta.url)));
const leagueSlate = (league, overrides = {}) => {
  const puzzle = { ...structuredClone(sample), league, ...overrides };
  delete puzzle.gridIron;
  delete puzzle.twoMinuteDrill;
  return puzzle;
};

test("owner preview collects same-date local and saved editions without losing the current unsaved slate", async () => {
  const active = { ...structuredClone(sample), title: "Current unsaved title" };
  const nfl = leagueSlate("nfl"),
    mlb = leagueSlate("mlb");
  const reads = [];
  const editions = await collectPreviewEditions(active, {
    draftFor: (league) => (league === "nfl" ? nfl : null),
    loadSaved: async (league) => {
      reads.push(league);
      if (league === "mlb") return mlb;
      if (league === "nba") return leagueSlate("nba", { date: "2032-01-01" });
      throw new Error("Offline");
    },
  });
  assert.deepEqual(Object.keys(editions), ["general", "nfl", "mlb"]);
  assert.equal(editions.general.title, "Current unsaved title");
  assert.ok(!reads.includes("nfl"));
  editions.nfl.title = "Changed in test";
  assert.notEqual(nfl.title, "Changed in test");
});

test("unfinished local work is excluded instead of previewing an older saved edition", async () => {
  const nfl = leagueSlate("nfl");
  nfl.playerGuess.hints = [];
  const reads = [];
  const editions = await collectPreviewEditions(sample, {
    draftFor: (league) => (league === "nfl" ? nfl : null),
    loadSaved: async (league) => {
      reads.push(league);
      return null;
    },
  });
  assert.deepEqual(Object.keys(editions), ["general"]);
  assert.ok(!reads.includes("nfl"));
  await assert.rejects(collectPreviewEditions(nfl, { draftFor() {}, loadSaved() {} }), /Finish/);
});

test("preview bundles validate dates and league labels and preserve the active edition", () => {
  const nfl = leagueSlate("nfl");
  const editions = previewEditions(nfl, {
    general: sample,
    nfl: leagueSlate("nfl", { title: "Stale replacement" }),
    mlb: leagueSlate("nba"),
    nba: leagueSlate("nba", { date: "2032-01-01" }),
    ncaaf: {},
    unsupported: sample,
  });
  assert.deepEqual(Object.keys(editions), ["general", "nfl"]);
  assert.equal(editions.nfl.title, nfl.title);
  assert.deepEqual(previewEditions(null, { general: sample }), {});
});
