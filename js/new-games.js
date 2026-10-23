import { DRILL_MS, normalize, puzzleFingerprint } from "./core.js";

export function placeGrid(state, puzzle, cell, name) {
  if (state.done) return state;
  if (
    !Number.isInteger(cell) ||
    cell < 0 ||
    cell > 8 ||
    !Number.isInteger(name) ||
    name < 0 ||
    name > 8
  )
    throw new Error("Choose a name, then a square.");
  if (state.placements[cell] !== null || state.placements.includes(name)) return state;
  const placements = [...state.placements],
    mistakes = [...state.mistakes];
  const correct = puzzle.gridIron.cells[cell].answer === puzzle.gridIron.names[name];
  if (correct) placements[cell] = name;
  else mistakes[cell] = Math.min(100000, mistakes[cell] + 1);
  const score = placements.filter((x) => x !== null).length;
  return {
    ...state,
    placements,
    mistakes,
    selected: correct ? null : name,
    score,
    done: score === 9,
    won: score === 9,
    lastCorrect: correct,
  };
}

// Stable across refreshes, but independent of the answer positions.
export function gridBank(puzzle) {
  let seed = parseInt(puzzleFingerprint(puzzle), 36) >>> 0;
  const bank = Array.from({ length: 9 }, (_, i) => i);
  for (let i = 8; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [bank[i], bank[j]] = [bank[j], bank[i]];
  }
  return bank;
}

export function startDrill(state, now = Date.now()) {
  if (state.done || state.startedAt !== null) return state;
  return { ...state, startedAt: now, deadline: now + DRILL_MS };
}
export function finishDrill(state, now = Date.now(), total = Infinity) {
  if (
    state.done ||
    state.startedAt === null ||
    (now < state.deadline && state.found.length < total)
  )
    return state;
  return { ...state, done: true, won: state.found.length > 0, score: state.found.length };
}
export function drillAnswer(puzzle, guess) {
  const key = normalize(guess);
  if (!key) return;
  const answers = puzzle.twoMinuteDrill.answers;
  // A complete answer always takes priority over an ambiguous surname.
  const exact = answers.find((answer) => normalize(answer.answer) === key);
  if (exact) return exact;
  const candidates = answers.filter((answer) => {
    const names = [
      answer.answer,
      ...(answer.aliases || []).filter((name) => name.trim().split(/\s+/).length > 1),
    ];
    const parts = names.map((name) => name.trim().split(/\s+/).filter(Boolean));
    if (parts.some((words) => words.length > 1 && normalize(words[0]) === key)) return false;
    return (
      names.some((name) => normalize(name) === key) ||
      parts.some((words) => {
        if (/^(jr|sr|ii|iii|iv|v)$/i.test(normalize(words.at(-1)))) words = words.slice(0, -1);
        return words.length > 1 && normalize(words.at(-1)) === key;
      }) ||
      (answer.aliases || []).some((alias) => normalize(alias) === key)
    );
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}
export function guessDrill(state, puzzle, guess, now = Date.now()) {
  state = finishDrill(state, now, puzzle.twoMinuteDrill.answers.length);
  if (state.done) return { state, outcome: "finished" };
  if (state.startedAt === null) throw new Error("Start the clock first.");
  if (!normalize(guess)) throw new Error("Enter a player or answer.");
  const answer = drillAnswer(puzzle, guess);
  if (!answer)
    return { state: { ...state, misses: Math.min(1000000, state.misses + 1) }, outcome: "miss" };
  const key = normalize(answer.answer);
  if (state.found.includes(key)) return { state, outcome: "duplicate" };
  const found = [...state.found, key];
  return {
    state: finishDrill(
      { ...state, found, score: found.length },
      now,
      puzzle.twoMinuteDrill.answers.length,
    ),
    outcome: "correct",
    key,
  };
}

export function parseDrillAnswers(value) {
  return value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((item) => {
      const [answer, ...aliases] = item
        .split("|")
        .map((x) => x.trim())
        .filter(Boolean);
      return { answer, aliases };
    });
}
export const formatDrillAnswers = (answers) =>
  answers.map((x) => [x.answer, ...x.aliases].join(" | ")).join(", ");
