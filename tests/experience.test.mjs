import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withTimeout } from "../js/async.js";
import { createOwnerAccess } from "../js/owner-access.js";
import { firstAcross, crossSelection, crosswordLetters } from "../js/crossword.js";
import {
  BASE_GAMES,
  GAMES,
  buildCrossword,
  newState,
  guessPlayer,
  guessLadder,
  shareBigThree,
  shareScore,
  shareSlate,
  stateFromRecordedResult,
} from "../js/core.js";
import { drillAnswer } from "../js/new-games.js";

const sample = JSON.parse(readFileSync(new URL("../data/practice.json", import.meta.url)));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("owner desk stays locked for guests, unlisted accounts, and failed access checks", async () => {
  let locks = 0,
    mounts = 0,
    denials = 0;
  const access = createOwnerAccess({
    verify: async (uid) => {
      if (uid === "offline") throw new Error("Offline");
      return uid === "owner";
    },
    lock: () => locks++,
    unlock: () => {
      mounts++;
    },
    deny: () => denials++,
  });
  await access.check(null);
  await access.check({ uid: "visitor" });
  await access.check({ uid: "offline" });
  assert.equal(mounts, 0);
  assert.equal(denials, 2);
  assert.ok(locks >= 3);
  await access.check({ uid: "owner" });
  assert.equal(mounts, 1);
});

test("a late owner verification cannot reopen the desk after sign-out or an account switch", async () => {
  const verification = deferred();
  const mounted = [];
  const access = createOwnerAccess({
    verify: (uid) => (uid === "owner" ? verification.promise : Promise.resolve(false)),
    lock() {},
    unlock: (user) => mounted.push(user.uid),
    deny() {},
  });
  const pending = access.check({ uid: "owner" });
  await access.check(null);
  verification.resolve(true);
  await pending;
  assert.deepEqual(mounted, []);
  const later = deferred();
  const second = createOwnerAccess({
    verify: (uid) => (uid === "owner" ? later.promise : Promise.resolve(false)),
    lock() {},
    unlock: (user) => mounted.push(user.uid),
    deny() {},
  });
  const oldAccount = second.check({ uid: "owner" });
  await second.check({ uid: "visitor" });
  later.resolve(true);
  await oldAccount;
  assert.deepEqual(mounted, []);
});

test("sign-out disposes a mounted desk and also disposes a desk still preparing", async () => {
  let disposed = 0;
  const options = {
    verify: async () => true,
    lock() {},
    deny() {},
    unlock: async () => () => disposed++,
  };
  const access = createOwnerAccess(options);
  await access.check({ uid: "owner" });
  await access.check(null);
  assert.equal(disposed, 1);
  const preparing = deferred();
  const pendingAccess = createOwnerAccess({ ...options, unlock: () => preparing.promise });
  const pending = pendingAccess.check({ uid: "owner" });
  await Promise.resolve();
  await pendingAccess.check(null);
  preparing.resolve(() => disposed++);
  await pending;
  assert.equal(disposed, 2);
});

test("loading deadlines settle a stalled request and tolerate a late resolution or rejection", async () => {
  assert.equal(await withTimeout(Promise.resolve("slate"), 100), "slate");
  await assert.rejects(withTimeout(Promise.reject(new Error("Offline")), 100), /Offline/);
  const late = deferred();
  await assert.rejects(withTimeout(late.promise, 5, "Try again"), /Try again/);
  late.resolve("late slate");
  const failed = deferred();
  await assert.rejects(withTimeout(failed.promise, 5), /too long/);
  failed.reject(new Error("Late offline"));
  await Promise.resolve();
});

test("crossword starts in the first Across even when owner entries list Down first; its first click keeps Across", () => {
  const data = structuredClone(sample.crossSport);
  data.entries.reverse();
  const model = buildCrossword(data),
    across = firstAcross(model),
    cell = across.positions[0];
  assert.equal(across.number, 1);
  assert.equal(across.direction, "across");
  assert.deepEqual(crossSelection(model, across.id, cell, cell, false), { entry: across.id, cell });
  const second = crossSelection(model, across.id, cell, cell, true);
  assert.equal(model.entries.find((entry) => entry.id === second.entry).direction, "down");
});

test("The Big Three share keeps each game's emoji score while optional games remain unfinished", () => {
  const states = Object.fromEntries(GAMES.map((game) => [game, newState(game, sample)]));
  states.player = guessPlayer(states.player, sample, "Wrong");
  states.player = guessPlayer(states.player, sample, "Wrong again");
  states.player = guessPlayer(states.player, sample, sample.playerGuess.answer);
  for (const [i, question] of sample.statLadder.questions.entries())
    states.ladder = guessLadder(
      states.ladder,
      sample,
      i === 2 || i === 4 ? question.answer : "Wrong",
    );
  states.cross = { ...states.cross, done: true, won: true, score: 1, elapsedMs: 75000 };
  const url = "https://example.com/index.html",
    text = shareBigThree(states, sample, "practice", url);
  assert.match(text, /The Big Three\nPlayer Guess: 3\/5\n🟥🟥🟩⬛⬛/);
  assert.match(text, /Stat Ladder: 8\/15/);
  assert.match(text, /CrossSport: Complete · 01:15/);
  assert.equal(text.split(url).length - 1, 1);
  assert.ok(!text.includes("The Matchup"));
  assert.ok(!text.includes("Two Minute Drill"));
  for (const game of BASE_GAMES) {
    assert.ok(
      text.includes(
        shareScore(game, states[game], sample, "practice").split("\n").slice(1).join("\n"),
      ),
    );
    assert.throws(
      () => shareBigThree({ ...states, [game]: { ...states[game], done: false } }, sample),
      /Finish Player Guess/,
    );
  }
  assert.match(shareBigThree(states, { ...sample, league: "nfl" }), /· NFL/);
});

test("restored crossword review shows the solution without changing saved play history or assistance", () => {
  const model = buildCrossword(sample.crossSport);
  const state = stateFromRecordedResult(
    {
      game: "cross",
      date: sample.date,
      score: 1,
      won: true,
      checks: 4,
      reveals: 3,
      elapsedMs: 75432,
    },
    sample,
  );
  const original = structuredClone(state);
  const letters = crosswordLetters(state, model);
  for (const entry of model.entries)
    assert.equal(entry.positions.map((i) => letters[i]).join(""), entry.answer);
  assert.deepEqual(state, original);
  assert.ok(state.letters.every((letter) => letter === ""));
  assert.deepEqual(state.reveals, []);
  assert.match(
    shareScore("cross", state, sample),
    /01:15\n🟨 Assisted · 4 checks · 3 letter reveals/,
  );
  for (const done of [false, true]) {
    const local = { ...newState("cross", sample), done };
    assert.equal(crosswordLetters(local, model), local.letters);
  }
});

test("mixed restored and local scores share real totals and keep available emojis without inventing history", () => {
  const states = Object.fromEntries(
    GAMES.map((game) => [
      game,
      stateFromRecordedResult(
        {
          game,
          date: sample.date,
          score: { player: 3, ladder: 8, cross: 1, grid: 9, drill: 4 }[game],
          won: true,
          checks: game === "grid" ? 2 : 0,
          reveals: 0,
        },
        sample,
      ),
    ]),
  );
  let text = shareSlate(states, sample);
  for (const score of ["Player Guess: 3/5", "Stat Ladder: 8/15", "The Matchup: 9/9\n2 mistakes"])
    assert.ok(text.includes(score));
  assert.ok(!text.includes("Saved result"));
  assert.ok(!text.includes("⬛"));
  states.player = guessPlayer(newState("player", sample), sample, "Wrong");
  states.player = guessPlayer(states.player, sample, "", true);
  states.player = guessPlayer(states.player, sample, sample.playerGuess.answer);
  text = shareBigThree(states, sample);
  assert.match(text, /Player Guess: 3\/5\n🟥⬜🟩⬛⬛\nStat Ladder: 8\/15\nCrossSport:/);
  for (const answer of [
    sample.playerGuess.answer,
    ...sample.statLadder.questions.map((q) => q.answer),
  ])
    assert.ok(!text.includes(answer));
});

test("Drill accepts full names and unique last names, rejects first names, and handles suffixes and shared surnames", () => {
  const answers = [
    { answer: "Patrick Mahomes", aliases: ["Patrick", "Mahomes"] },
    { answer: "Robert Griffin III", aliases: [] },
    { answer: "Josh Allen", aliases: [] },
    { answer: "Keenan Allen", aliases: [] },
  ];
  const puzzle = { twoMinuteDrill: { answers } };
  assert.equal(drillAnswer(puzzle, "Patrick Mahomes"), answers[0]);
  assert.equal(drillAnswer(puzzle, "mahomes"), answers[0]);
  assert.equal(drillAnswer(puzzle, "Patrick"), undefined);
  assert.equal(drillAnswer(puzzle, "Robert"), undefined);
  assert.equal(drillAnswer(puzzle, "Griffin"), answers[1]);
  assert.equal(drillAnswer(puzzle, "III"), undefined);
  assert.equal(drillAnswer(puzzle, "Allen"), undefined);
  assert.equal(drillAnswer(puzzle, "Josh Allen"), answers[2]);
});
