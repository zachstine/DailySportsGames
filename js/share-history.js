const EMOJI = { g: "🟩", r: "🟥", w: "⬜", b: "⬛", y: "🟨", "?": "❔" };

export function validSharePattern({ game, score, checks = 0, sharePattern: pattern }) {
  if (typeof pattern !== "string") return false;
  if (game === "player") {
    if (score === 0) return /^[rw]{5}$/.test(pattern);
    return (
      Number.isInteger(score) &&
      score >= 1 &&
      score <= 5 &&
      pattern.length === 5 &&
      /^[rw]*gb*$/.test(pattern) &&
      pattern.indexOf("g") === 5 - score
    );
  }
  if (game === "ladder")
    return (
      /^[grw]{5}$/.test(pattern) &&
      [...pattern].reduce((total, letter, i) => total + (letter === "g" ? i + 1 : 0), 0) === score
    );
  if (game === "grid") {
    const assisted = [...pattern].filter((letter) => letter === "y").length;
    return (
      score === 9 &&
      /^[gy]{9}$/.test(pattern) &&
      Number.isInteger(checks) &&
      assisted <= checks &&
      (assisted === 0) === (checks === 0)
    );
  }
  return false;
}

function playedPattern(game, state) {
  if (game === "player" || game === "ladder") {
    const attempts = state.attempts;
    if (
      !Array.isArray(attempts) ||
      attempts.some((a) => !a || typeof a.correct !== "boolean" || typeof a.skipped !== "boolean")
    )
      return undefined;
    const pattern = attempts.map((a) => (a.correct ? "g" : a.skipped ? "w" : "r")).join("");
    return game === "player" ? pattern.padEnd(5, "b") : pattern;
  }
  if (game === "grid" && Array.isArray(state.placements) && Array.isArray(state.mistakes))
    return state.placements
      .map((name, i) => (name === null ? "b" : state.mistakes[i] ? "y" : "g"))
      .join("");
  return undefined;
}

export function resultSharePattern(game, state) {
  if (!state?.done || !["player", "ladder", "grid"].includes(game)) return undefined;
  const pattern = state.recordedOnly ? state.sharePattern : playedPattern(game, state);
  const checks =
    game === "grid"
      ? (state.totalMistakes ??
        (Array.isArray(state.mistakes) ? state.mistakes.reduce((a, b) => a + b, 0) : -1))
      : 0;
  return validSharePattern({ game, score: state.score, checks, sharePattern: pattern })
    ? pattern
    : undefined;
}

function legacyPattern(game, state) {
  if (game === "player")
    return state.score > 0
      ? "?".repeat(5 - state.score) + "g" + "b".repeat(state.score - 1)
      : "?????";
  if (game === "ladder") {
    const possible = Array.from({ length: 32 }, (_, mask) => mask).filter(
      (mask) =>
        [1, 2, 3, 4, 5].reduce((sum, weight, i) => sum + (mask & (1 << i) ? weight : 0), 0) ===
        state.score,
    );
    return [0, 1, 2, 3, 4]
      .map((i) => (possible.length && possible.every((mask) => mask & (1 << i)) ? "g" : "?"))
      .join("");
  }
  return state.totalMistakes === 0 ? "ggggggggg" : "?????????";
}

export function shareBlocks(game, state) {
  const pattern =
    resultSharePattern(game, state) ??
    (state.recordedOnly ? legacyPattern(game, state) : playedPattern(game, state));
  const blocks = [...pattern].map((letter) => EMOJI[letter]);
  return game === "grid"
    ? [0, 3, 6].map((start) => blocks.slice(start, start + 3).join("")).join("\n")
    : blocks.join("");
}

export function missingShareHistory(game, state) {
  return ["player", "ladder", "grid"].includes(game) && shareBlocks(game, state).includes("❔");
}
