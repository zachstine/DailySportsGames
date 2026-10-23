import test from "node:test";
import assert from "node:assert/strict";
import {
  activeSeason,
  appearanceSettings,
  cachedAppearance,
  CACHE_AGE,
  colorMode,
} from "../js/appearance-model.js";
import { loadAppearance, saveAppearance } from "../js/appearance-store.js";

const halloween = { season: "halloween", startsOn: "2026-10-24", endsOn: "2026-10-31" };

test("season dates include both boundaries and return to Classic outside the window", () => {
  assert.equal(activeSeason(halloween, "2026-10-23"), "classic");
  assert.equal(activeSeason(halloween, "2026-10-24"), "halloween");
  assert.equal(activeSeason(halloween, "2026-10-31"), "halloween");
  assert.equal(activeSeason(halloween, "2026-11-01"), "classic");
  assert.equal(activeSeason({ ...halloween, startsOn: "", endsOn: "" }), "halloween");
  assert.equal(activeSeason({ ...halloween, endsOn: "" }, "2030-01-01"), "halloween");
});

test("invalid or reversed dates and unknown theme names are rejected", () => {
  for (const value of [
    null,
    {},
    { ...halloween, season: "__proto__" },
    { ...halloween, startsOn: "2026-02-30" },
    { ...halloween, startsOn: "2026-11-01" },
    { ...halloween, endsOn: null },
    { ...halloween, season: "<script>" },
  ]) {
    assert.equal(appearanceSettings(value), null);
    assert.equal(activeSeason(value, "2026-10-31"), "classic");
  }
});

test("unneeded database fields never reach the presentation cache", () => {
  assert.deepEqual(
    appearanceSettings({ ...halloween, updatedAt: {}, privateNote: "hidden" }),
    halloween,
  );
});

test("a device reuses the public setting for fifteen minutes and refreshes expired or corrupt caches", () => {
  const now = 10000000;
  assert.deepEqual(
    cachedAppearance({ settings: halloween, fetchedAt: now - CACHE_AGE + 1 }, now),
    halloween,
  );
  for (const value of [
    { settings: halloween, fetchedAt: now - CACHE_AGE },
    { settings: halloween, fetchedAt: now + 1 },
    { settings: halloween, fetchedAt: "yesterday" },
    { settings: {}, fetchedAt: now },
    null,
  ])
    assert.equal(cachedAppearance(value, now), null);
});

test("an explicit light or dark preference takes priority over the device appearance", () => {
  assert.equal(colorMode("light", true), "light");
  assert.equal(colorMode("dark", false), "dark");
  assert.equal(colorMode(null, true), "dark");
  assert.equal(colorMode(null, false), "light");
  assert.equal(colorMode("invalid", true), "dark");
});

function client(existing) {
  const writes = [],
    reads = [];
  return {
    writes,
    reads,
    db: {},
    auth: { currentUser: { uid: "owner" } },
    store: {
      doc: (_db, ...parts) => parts.join("/"),
      serverTimestamp: () => "server-time",
      getDocFromServer: async (path) => {
        reads.push(path);
        return { exists: () => Boolean(existing), data: () => existing };
      },
      setDoc: async (path, data) => {
        writes.push({ path, data });
      },
    },
  };
}

test("appearance uses its own public presentation document and leaves puzzles and scores alone", async () => {
  const connection = client(halloween);
  assert.deepEqual(await loadAppearance(connection), halloween);
  await saveAppearance(connection, { ...halloween, unrelated: "discard" });
  assert.deepEqual(connection.reads, ["siteSettings/appearance"]);
  assert.deepEqual(connection.writes, [
    {
      path: "siteSettings/appearance",
      data: { ...halloween, updatedAt: "server-time" },
    },
  ]);
});

test("an empty settings document falls back to Classic; invalid saved data is reported", async () => {
  assert.deepEqual(await loadAppearance(client()), { season: "classic", startsOn: "", endsOn: "" });
  await assert.rejects(loadAppearance(client({ season: "broken" })), /owner correction/);
});

test("invalid theme values and signed-out owners cannot initiate writes", async () => {
  const connection = client();
  await assert.rejects(
    saveAppearance(connection, { ...halloween, endsOn: "2020-01-01" }),
    /valid date/,
  );
  connection.auth.currentUser = null;
  await assert.rejects(saveAppearance(connection, halloween), /Sign in as an owner/);
  assert.equal(connection.writes.length, 0);
});
