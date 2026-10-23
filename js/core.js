export const TIME_ZONE = "America/New_York";
export const BASE_GAMES = ["player", "ladder", "cross"];
export const GAMES = [...BASE_GAMES, "grid", "drill"];
export const GAME_NAMES = {
  player: "Player Guess",
  ladder: "Stat Ladder",
  cross: "CrossSport",
  grid: "The Matchup",
  drill: "The Two Minute Drill",
};
export const GAME_FIELDS = {
  player: "playerGuess",
  ladder: "statLadder",
  cross: "crossSport",
  grid: "gridIron",
  drill: "twoMinuteDrill",
};
export const LEAGUES = ["general", "nfl", "mlb", "nba", "ncaaf"];
export const LEAGUE_NAMES = {
  general: "General",
  nfl: "NFL",
  mlb: "MLB",
  nba: "NBA",
  ncaaf: "NCAAF",
};
export const DRILL_MS = 120000;
export const leagueOf = (value) => value?.league || "general";
export const editionKey = (date, league = "general") =>
  league === "general" ? date : `${league}:${date}`;
export const puzzlePath = (date, league = "general") =>
  league === "general" ? ["dailyPuzzles", date] : [`leaguePuzzles/${league}/days`, date];
export const gamesForLeague = (league) => (league === "general" ? [...GAMES] : [...BASE_GAMES]);
// Released three-game slates stay playable without inventing new content.
export const gamesForPuzzle = (puzzle) =>
  gamesForLeague(leagueOf(puzzle)).filter(
    (game) => BASE_GAMES.includes(game) || puzzle?.[GAME_FIELDS[game]],
  );
export const resultLimit = (game) =>
  ({ player: 5, ladder: 15, cross: 1, grid: 9, drill: 500 })[game];

export function validElapsedMs(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function formatDuration(elapsedMs) {
  if (!validElapsedMs(elapsedMs)) return "—";
  const seconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return [hours || null, String(minutes).padStart(2, "0"), String(seconds % 60).padStart(2, "0")]
    .filter((x) => x !== null)
    .join(":");
}

// Only time spent in the open crossword counts. A monotonic clock avoids
// adding time while the tab is closed or when the system clock changes.
export class SolveTimer {
  constructor(elapsedMs = 0, now = () => performance.now()) {
    this.total = validElapsedMs(elapsedMs) ? elapsedMs : 0;
    this.now = now;
    this.startedAt = null;
  }
  get running() {
    return this.startedAt !== null;
  }
  start() {
    if (!this.running) this.startedAt = this.now();
  }
  elapsed() {
    return Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.floor(this.total + (this.running ? Math.max(0, this.now() - this.startedAt) : 0)),
    );
  }
  pause() {
    if (this.running) {
      this.total = this.elapsed();
      this.startedAt = null;
    }
    return this.total;
  }
}

export function gameScoreLabel(game, result) {
  if (!result) return "—";
  if (game === "cross")
    return result.done
      ? validElapsedMs(result.elapsedMs)
        ? formatDuration(result.elapsedMs)
        : "Complete"
      : "In progress";
  if (game === "grid") return `${result.score}/9`;
  if (game === "drill") return `${result.score} answer${result.score === 1 ? "" : "s"}`;
  return `${result.score}/${game === "ladder" ? 15 : 5}`;
}

export function dateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function validDate(value) {
  return (
    typeof value === "string" &&
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}

export function shiftDate(value, days) {
  if (!validDate(value)) throw new Error("Use a valid date in YYYY-MM-DD format.");
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Resolve Eastern midnight with its actual offset, including DST transitions.
export function releaseTime(value) {
  if (!validDate(value)) throw new Error("Invalid release date.");
  const [year, month, day] = value.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let candidate = target;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map((x) => [x.type, x.value]),
    );
    const wallTime = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    candidate += target - wallTime;
  }
  return candidate;
}

export function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function matches(value, question) {
  const answer = normalize(value);
  return (
    answer.length > 0 &&
    [question.answer, ...(question.aliases || [])].some((x) => normalize(x) === answer)
  );
}

export function crosswordAnswer(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

export function buildCrossword(puzzle) {
  const errors = [];
  const size = puzzle?.size;
  if (!Number.isInteger(size) || size < 5 || size > 11)
    return { errors: ["CrossSport size must be an integer from 5 to 11."] };
  if (!Array.isArray(puzzle.entries) || puzzle.entries.length < 2 || puzzle.entries.length > 40) {
    return { errors: ["CrossSport needs 2–40 entries."] };
  }
  const cells = Array.from({ length: size * size }, () => null);
  const entries = [];
  for (const [index, entry] of puzzle.entries.entries()) {
    const prefix = `CrossSport entry ${index + 1}`;
    const answer = crosswordAnswer(entry?.answer);
    const { row, col, direction } = entry || {};
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 0 ||
      col < 0 ||
      !["across", "down"].includes(direction) ||
      answer.length < 2 ||
      row + (direction === "down" ? answer.length : 1) > size ||
      col + (direction === "across" ? answer.length : 1) > size
    ) {
      errors.push(`${prefix}: check start, direction, length, and grid bounds.`);
      continue;
    }
    if (!text(entry.clue, 500)) errors.push(`${prefix}: add a clue (maximum 500 characters).`);
    const positions = [];
    for (let offset = 0; offset < answer.length; offset++) {
      const r = row + (direction === "down" ? offset : 0);
      const c = col + (direction === "across" ? offset : 0);
      const position = r * size + c;
      if (cells[position]?.letter !== undefined && cells[position].letter !== answer[offset]) {
        errors.push(`${prefix}: conflicting letter at row ${r + 1}, column ${c + 1}.`);
      }
      if (cells[position]?.directions.includes(direction))
        errors.push(`${prefix}: overlaps another ${direction} entry.`);
      cells[position] ||= { letter: answer[offset], directions: [], entries: [] };
      cells[position].directions.push(direction);
      cells[position].entries.push(index);
      positions.push(position);
    }
    entries.push({ ...entry, answer, positions, id: index });
  }
  if (
    !entries.some((e) => e.direction === "across") ||
    !entries.some((e) => e.direction === "down")
  ) {
    errors.push("CrossSport needs both across and down entries.");
  }
  // Every contiguous run of 2+ letters must have exactly one matching clue.
  for (const direction of ["across", "down"]) {
    for (let row = 0; row < size; row++)
      for (let col = 0; col < size; col++) {
        const position = row * size + col;
        if (!cells[position]) continue;
        const prior =
          direction === "across"
            ? col > 0 && cells[position - 1]
            : row > 0 && cells[position - size];
        if (prior) continue;
        const run = [];
        for (
          let r = row, c = col;
          r < size && c < size && cells[r * size + c];
          r += direction === "down" ? 1 : 0, c += direction === "across" ? 1 : 0
        ) {
          run.push(r * size + c);
        }
        if (
          run.length > 1 &&
          !entries.some(
            (e) =>
              e.direction === direction &&
              e.row === row &&
              e.col === col &&
              e.positions.length === run.length,
          )
        ) {
          errors.push(
            `Unclued ${direction} word at row ${row + 1}, column ${col + 1}; separate adjacent entries with a black square.`,
          );
        }
      }
  }
  if (entries.length) {
    const reached = new Set([entries[0].id]);
    for (let pass = 0; pass < entries.length; pass++)
      for (const entry of entries) {
        if (entry.positions.some((p) => cells[p].entries.some((id) => reached.has(id))))
          reached.add(entry.id);
      }
    if (reached.size !== entries.length)
      errors.push("All CrossSport entries must connect through shared letters.");
  }
  const starts = [...new Set(entries.map((e) => e.row * size + e.col))].sort((a, b) => a - b);
  for (const entry of entries) entry.number = starts.indexOf(entry.row * size + entry.col) + 1;
  for (const [i, start] of starts.entries()) if (cells[start]) cells[start].number = i + 1;
  return { size, cells, entries, errors: [...new Set(errors)] };
}

function text(value, max = 300) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function answerErrors(question, prefix) {
  const errors = [];
  if (!text(question?.answer, 120) || !normalize(question?.answer))
    errors.push(`${prefix}: add an answer (maximum 120 characters).`);
  if (
    !Array.isArray(question?.aliases) ||
    question.aliases.length > 20 ||
    question.aliases.some((x) => !text(x, 120) || !normalize(x))
  ) {
    errors.push(`${prefix}: aliases must be an array of up to 20 nonempty names.`);
  }
  return errors;
}

export function validateGame(game, data) {
  if (!GAMES.includes(game))
    return ["Choose Player Guess, Stat Ladder, CrossSport, The Matchup, or Two Minute Drill."];
  if (!data || typeof data !== "object" || Array.isArray(data))
    return [`${GAME_NAMES[game]} needs a puzzle object.`];
  const errors = [];
  const fields = {
    player: ["answer", "sport", "aliases", "hints"],
    ladder: ["questions"],
    cross: ["size", "entries"],
    grid: ["names", "cells"],
    drill: ["question", "answers"],
  };
  if (Object.keys(data).some((key) => !fields[game].includes(key)))
    errors.push(`${GAME_NAMES[game]} contains an unexpected field.`);
  if (game === "player") {
    errors.push(...answerErrors(data, "Player Guess"));
    if (!text(data.sport, 30))
      errors.push("Player Guess: add a sport or league (maximum 30 characters). ");
    if (
      !Array.isArray(data.hints) ||
      data.hints.length !== 5 ||
      data.hints.some((x) => !text(x, 500))
    )
      errors.push("Player Guess needs exactly five nonempty hints, each at most 500 characters.");
  }
  if (game === "ladder" && (!Array.isArray(data.questions) || data.questions.length !== 5)) {
    errors.push("Stat Ladder needs exactly five questions, ordered easy to hard.");
  } else if (game === "ladder")
    for (const [i, question] of data.questions.entries()) {
      errors.push(...answerErrors(question, `Stat Ladder question ${i + 1}`));
      if (!text(question?.question, 500))
        errors.push(`Stat Ladder question ${i + 1}: add a question (maximum 500 characters).`);
      if (!text(question?.sport, 30))
        errors.push(`Stat Ladder question ${i + 1}: add a sport or league.`);
      try {
        const url = new URL(question?.source);
        if (url.protocol !== "https:") throw new Error();
      } catch {
        errors.push(
          `Stat Ladder question ${i + 1}: add an https source URL to verify the statistic.`,
        );
      }
    }
  if (game === "cross") errors.push(...buildCrossword(data).errors);
  if (game === "grid") {
    if (
      !Array.isArray(data.names) ||
      data.names.length !== 9 ||
      data.names.some((x) => !text(x, 120) || !normalize(x)) ||
      new Set(data.names.map(normalize)).size !== 9
    )
      errors.push("The Matchup needs exactly nine distinct player or coach names.");
    if (
      !Array.isArray(data.cells) ||
      data.cells.length !== 9 ||
      data.cells.some(
        (x) => !text(x?.clue, 500) || !Array.isArray(data.names) || !data.names.includes(x?.answer),
      ) ||
      new Set(data.cells?.map((x) => x?.answer)).size !== 9
    )
      errors.push("The Matchup needs nine clues, each assigned to a different name in the bank.");
  }
  if (game === "drill") {
    if (!text(data.question, 500))
      errors.push("Two Minute Drill needs a question (maximum 500 characters).");
    if (!Array.isArray(data.answers) || !data.answers.length || data.answers.length > 500)
      errors.push("Two Minute Drill needs 1–500 accepted answers.");
    else {
      const seen = new Set();
      for (const [i, answer] of data.answers.entries()) {
        errors.push(...answerErrors(answer, `Drill answer ${i + 1}`));
        const keys = [
          answer?.answer,
          ...(Array.isArray(answer?.aliases) ? answer.aliases : []),
        ].map(normalize);
        for (const key of new Set(keys)) {
          if (seen.has(key))
            errors.push(
              `Drill answer ${i + 1}: this name or alias already belongs to another answer.`,
            );
          seen.add(key);
        }
      }
    }
  }
  if (JSON.stringify(data).length > 50000) errors.push("A single game must be smaller than 50 KB.");
  return errors;
}

export function validatePuzzle(puzzle) {
  if (!puzzle || typeof puzzle !== "object" || Array.isArray(puzzle))
    return ["The puzzle file must be a JSON object."];
  const errors = [];
  if (puzzle.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (!validDate(puzzle.date)) errors.push("Choose a valid release date (YYYY-MM-DD). ");
  if (!text(puzzle.title, 120)) errors.push("Add a daily title (maximum 120 characters). ");
  if (!LEAGUES.includes(leagueOf(puzzle))) errors.push("Choose General, NFL, MLB, NBA, or NCAAF.");
  if (leagueOf(puzzle) !== "general" && (puzzle.gridIron || puzzle.twoMinuteDrill))
    errors.push("League editions contain Player Guess, Stat Ladder, and CrossSport only.");
  for (const game of gamesForPuzzle(puzzle))
    errors.push(...validateGame(game, puzzle[GAME_FIELDS[game]]));
  if (JSON.stringify(puzzle).length > 150000)
    errors.push("The puzzle file must be smaller than 150 KB.");
  return errors;
}

export function newState(game, puzzle) {
  if (game === "player") return { attempts: [], done: false, won: false, score: 0 };
  if (game === "ladder") return { attempts: [], done: false, won: false, score: 0 };
  if (game === "cross")
    return {
      letters: Array(puzzle.crossSport.size ** 2).fill(""),
      checks: 0,
      reveals: [],
      elapsedMs: 0,
      done: false,
      won: false,
      score: 0,
    };
  if (game === "grid")
    return {
      placements: Array(9).fill(null),
      mistakes: Array(9).fill(0),
      selected: null,
      done: false,
      won: false,
      score: 0,
    };
  if (game === "drill")
    return {
      found: [],
      startedAt: null,
      deadline: null,
      ranked: false,
      misses: 0,
      done: false,
      won: false,
      score: 0,
    };
  throw new Error("Unknown game.");
}

export function validDailyResult(result) {
  if (!result || !GAMES.includes(result.game) || !validDate(result.date)) return false;
  const { game, score, won, checks, reveals } = result;
  const limit = resultLimit(game);
  return (
    Number.isInteger(score) &&
    score >= 0 &&
    score <= limit &&
    won === score > 0 &&
    LEAGUES.includes(leagueOf(result)) &&
    (leagueOf(result) === "general" || BASE_GAMES.includes(game)) &&
    Number.isInteger(checks) &&
    checks >= 0 &&
    checks <= 1000000 &&
    Number.isInteger(reveals) &&
    reveals >= 0 &&
    reveals <= 121 &&
    (game === "cross"
      ? score === 1
      : game === "grid"
        ? score === 9 && reveals === 0
        : checks === 0 && reveals === 0) &&
    (result.elapsedMs === undefined || (game === "cross" && validElapsedMs(result.elapsedMs)))
  );
}

export function stateFromRecordedResult(result, puzzle) {
  if (
    !validDailyResult(result) ||
    result.date !== puzzle.date ||
    leagueOf(result) !== leagueOf(puzzle) ||
    !gamesForPuzzle(puzzle).includes(result.game)
  )
    throw new Error("Invalid recorded result.");
  // A saved total does not contain the original guesses or revealed squares.
  return {
    ...newState(result.game, puzzle),
    done: true,
    won: result.won,
    score: result.score,
    recordedOnly: true,
    ...(result.game === "cross"
      ? { checks: result.checks, revealCount: result.reveals, elapsedMs: result.elapsedMs ?? null }
      : {}),
    ...(result.game === "grid" ? { totalMistakes: result.checks } : {}),
  };
}

export function guessPlayer(state, puzzle, guess, skip = false) {
  if (state.done) return state;
  if (!skip && !normalize(guess)) throw new Error("Enter a player name.");
  const correct = !skip && matches(guess, puzzle.playerGuess);
  const attempts = [
    ...state.attempts,
    { guess: skip ? "Skipped" : guess.trim().slice(0, 120), correct, skipped: skip },
  ];
  return {
    ...state,
    attempts,
    done: correct || attempts.length === 5,
    won: correct,
    score: correct ? 6 - attempts.length : 0,
  };
}

export function guessLadder(state, puzzle, guess, skip = false) {
  if (state.done) return state;
  if (!skip && !normalize(guess)) throw new Error("Enter your answer.");
  const question = puzzle.statLadder.questions[state.attempts.length];
  const correct = !skip && matches(guess, question);
  const attempts = [
    ...state.attempts,
    { guess: skip ? "Skipped" : guess.trim().slice(0, 120), correct, skipped: skip },
  ];
  const score = state.score + (correct ? attempts.length : 0);
  return {
    ...state,
    attempts,
    score,
    done: attempts.length === 5,
    won: attempts.length === 5 && score > 0,
  };
}

export function finishCrossword(state, model) {
  if (state.done) return state;
  const correct = model.cells.every((cell, index) => !cell || state.letters[index] === cell.letter);
  return { ...state, done: correct, won: correct, score: correct ? 1 : 0 };
}

export function streakStats(records, today = dateKey()) {
  const days = [...new Set(records.filter((r) => r.mode === "daily" && r.done).map((r) => r.date))]
    .filter(validDate)
    .sort();
  let best = 0,
    run = 0,
    previous = null;
  for (const day of days) {
    run = previous && shiftDate(previous, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  let current = 0;
  let cursor = days.includes(today) ? today : shiftDate(today, -1);
  const set = new Set(days);
  while (set.has(cursor)) {
    current++;
    cursor = shiftDate(cursor, -1);
  }
  return { current, best, played: days.length };
}

function shareEdition(puzzle, mode) {
  const label = mode === "daily" ? puzzle.date : mode === "preview" ? "Owner preview" : "Practice";
  return leagueOf(puzzle) === "general" ? label : `${label} · ${LEAGUE_NAMES[leagueOf(puzzle)]}`;
}

function gameShareLines(game, state) {
  let score, blocks;
  if (game === "player") {
    score = `${state.score}/5`;
    blocks = state.recordedOnly
      ? ""
      : [
          ...state.attempts.map((a) => (a.correct ? "🟩" : a.skipped ? "⬜" : "🟥")),
          ...Array(5 - state.attempts.length).fill("⬛"),
        ].join("");
  } else if (game === "ladder") {
    score = `${state.score}/15`;
    blocks = state.recordedOnly
      ? ""
      : state.attempts.map((a) => (a.correct ? "🟩" : a.skipped ? "⬜" : "🟥")).join("");
  } else if (game === "grid") {
    score = `${state.score}/9`;
    blocks = state.recordedOnly
      ? `${state.totalMistakes} mistake${state.totalMistakes === 1 ? "" : "s"}`
      : Array.from({ length: 3 }, (_, row) =>
          state.placements
            .slice(row * 3, row * 3 + 3)
            .map((name, i) => (name === null ? "⬛" : state.mistakes[row * 3 + i] ? "🟨" : "🟩"))
            .join(""),
        ).join("\n");
  } else if (game === "drill") {
    score = `${state.score} answer${state.score === 1 ? "" : "s"}`;
    blocks = `⏱️ 2:00 · ${state.score ? "🟩" : "🟥"}${state.ranked ? " Ranked" : ""}`;
  } else {
    score = state.done ? "Complete" : "In progress";
    if (state.done && validElapsedMs(state.elapsedMs))
      score += ` · ${formatDuration(state.elapsedMs)}`;
    const reveals = state.revealCount ?? state.reveals.length;
    blocks = `${reveals ? "🟨 Assisted" : "🟩 No reveals"} · ${state.checks} check${state.checks === 1 ? "" : "s"} · ${reveals} letter reveal${reveals === 1 ? "" : "s"}`;
  }
  return [`${GAME_NAMES[game]}: ${score}`, blocks].filter(Boolean);
}

export function shareSlate(states, puzzle, mode = "daily", url = "") {
  const games = gamesForPuzzle(puzzle);
  if (!games.every((game) => states[game]?.done))
    throw new Error("Finish all games to share your full slate.");
  return [
    `Daily Sports Games · ${shareEdition(puzzle, mode)}`,
    ...games.flatMap((game) => gameShareLines(game, states[game])),
    url,
  ]
    .filter(Boolean)
    .join("\n");
}

export function shareScore(game, state, puzzle, mode = "daily", url = "") {
  return [`Daily Sports Games · ${shareEdition(puzzle, mode)}`, ...gameShareLines(game, state), url]
    .filter(Boolean)
    .join("\n");
}

export function shareBigThree(states, puzzle, mode = "daily", url = "") {
  if (!BASE_GAMES.every((game) => states[game]?.done))
    throw new Error("Finish Player Guess, Stat Ladder, and CrossSport to share The Big Three.");
  return [
    `Daily Sports Games · ${shareEdition(puzzle, mode)}`,
    "The Big Three",
    ...BASE_GAMES.flatMap((game) => gameShareLines(game, states[game])),
    url,
  ]
    .filter(Boolean)
    .join("\n");
}

export function puzzleFingerprint(puzzle) {
  const value = JSON.stringify(puzzle);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}
