export const TIME_ZONE = "America/New_York";
export const GAMES = ["player", "ladder", "cross"];
export const GAME_NAMES = { player: "Player Guess", ladder: "Stat Ladder", cross: "CrossSport" };

export function dateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function validDate(value) {
  return typeof value === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
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
    timeZone: TIME_ZONE, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23"
  });
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(x => [x.type, x.value]));
    const wallTime = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    candidate += target - wallTime;
  }
  return candidate;
}

export function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function matches(value, question) {
  const answer = normalize(value);
  return answer.length > 0 && [question.answer, ...(question.aliases || [])].some(x => normalize(x) === answer);
}

export function crosswordAnswer(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
}

export function buildCrossword(puzzle) {
  const errors = [];
  const size = puzzle?.size;
  if (!Number.isInteger(size) || size < 5 || size > 11) return { errors: ["CrossSport size must be an integer from 5 to 11."] };
  if (!Array.isArray(puzzle.entries) || puzzle.entries.length < 2 || puzzle.entries.length > 40) {
    return { errors: ["CrossSport needs 2–40 entries."] };
  }
  const cells = Array.from({ length: size * size }, () => null);
  const entries = [];
  for (const [index, entry] of puzzle.entries.entries()) {
    const prefix = `CrossSport entry ${index + 1}`;
    const answer = crosswordAnswer(entry?.answer);
    const { row, col, direction } = entry || {};
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 ||
      !["across", "down"].includes(direction) || answer.length < 2 ||
      row + (direction === "down" ? answer.length : 1) > size ||
      col + (direction === "across" ? answer.length : 1) > size) {
      errors.push(`${prefix}: check start, direction, length, and grid bounds.`); continue;
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
      if (cells[position]?.directions.includes(direction)) errors.push(`${prefix}: overlaps another ${direction} entry.`);
      cells[position] ||= { letter: answer[offset], directions: [], entries: [] };
      cells[position].directions.push(direction);
      cells[position].entries.push(index);
      positions.push(position);
    }
    entries.push({ ...entry, answer, positions, id: index });
  }
  if (!entries.some(e => e.direction === "across") || !entries.some(e => e.direction === "down")) {
    errors.push("CrossSport needs both across and down entries.");
  }
  // Every contiguous run of 2+ letters must have exactly one matching clue.
  for (const direction of ["across", "down"]) {
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
      const position = row * size + col;
      if (!cells[position]) continue;
      const prior = direction === "across" ? (col > 0 && cells[position - 1]) : (row > 0 && cells[position - size]);
      if (prior) continue;
      const run = [];
      for (let r = row, c = col; r < size && c < size && cells[r * size + c];
        r += direction === "down" ? 1 : 0, c += direction === "across" ? 1 : 0) {
        run.push(r * size + c);
      }
      if (run.length > 1 && !entries.some(e => e.direction === direction && e.row === row && e.col === col && e.positions.length === run.length)) {
        errors.push(`Unclued ${direction} word at row ${row + 1}, column ${col + 1}; separate adjacent entries with a black square.`);
      }
    }
  }
  if (entries.length) {
    const reached = new Set([entries[0].id]);
    for (let pass = 0; pass < entries.length; pass++) for (const entry of entries) {
      if (entry.positions.some(p => cells[p].entries.some(id => reached.has(id)))) reached.add(entry.id);
    }
    if (reached.size !== entries.length) errors.push("All CrossSport entries must connect through shared letters.");
  }
  const starts = [...new Set(entries.map(e => e.row * size + e.col))].sort((a, b) => a - b);
  for (const entry of entries) entry.number = starts.indexOf(entry.row * size + entry.col) + 1;
  for (const [i, start] of starts.entries()) if (cells[start]) cells[start].number = i + 1;
  return { size, cells, entries, errors: [...new Set(errors)] };
}

function text(value, max = 300) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function answerErrors(question, prefix) {
  const errors = [];
  if (!text(question?.answer, 120) || !normalize(question?.answer)) errors.push(`${prefix}: add an answer (maximum 120 characters).`);
  if (!Array.isArray(question?.aliases) || question.aliases.length > 20 || question.aliases.some(x => !text(x, 120) || !normalize(x))) {
    errors.push(`${prefix}: aliases must be an array of up to 20 nonempty names.`);
  }
  return errors;
}

export function validatePuzzle(puzzle) {
  if (!puzzle || typeof puzzle !== "object" || Array.isArray(puzzle)) return ["The puzzle file must be a JSON object."];
  const errors = [];
  if (puzzle.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (!validDate(puzzle.date)) errors.push("Choose a valid release date (YYYY-MM-DD). ");
  if (!text(puzzle.title, 120)) errors.push("Add a daily title (maximum 120 characters). ");
  errors.push(...answerErrors(puzzle.playerGuess, "Player Guess"));
  if (!text(puzzle.playerGuess?.sport, 30)) errors.push("Player Guess: add a sport or league (maximum 30 characters). ");
  if (!Array.isArray(puzzle.playerGuess?.hints) || puzzle.playerGuess.hints.length !== 5 || puzzle.playerGuess.hints.some(x => !text(x, 500))) {
    errors.push("Player Guess needs exactly five nonempty hints, each at most 500 characters.");
  }
  if (!Array.isArray(puzzle.statLadder?.questions) || puzzle.statLadder.questions.length !== 5) {
    errors.push("Stat Ladder needs exactly five questions, ordered easy to hard.");
  } else for (const [i, question] of puzzle.statLadder.questions.entries()) {
    errors.push(...answerErrors(question, `Stat Ladder question ${i + 1}`));
    if (!text(question?.question, 500)) errors.push(`Stat Ladder question ${i + 1}: add a question (maximum 500 characters).`);
    if (!text(question?.sport, 30)) errors.push(`Stat Ladder question ${i + 1}: add a sport or league.`);
    try {
      const url = new URL(question?.source);
      if (url.protocol !== "https:") throw new Error();
    } catch { errors.push(`Stat Ladder question ${i + 1}: add an https source URL to verify the statistic.`); }
  }
  errors.push(...buildCrossword(puzzle.crossSport).errors);
  if (JSON.stringify(puzzle).length > 60000) errors.push("The puzzle file must be smaller than 60 KB.");
  return errors;
}

export function newState(game, puzzle) {
  if (game === "player") return { attempts: [], done: false, won: false, score: 0 };
  if (game === "ladder") return { attempts: [], done: false, won: false, score: 0 };
  if (game === "cross") return { letters: Array(puzzle.crossSport.size ** 2).fill(""), checks: 0, reveals: [], done: false, won: false, score: 0 };
  throw new Error("Unknown game.");
}

export function guessPlayer(state, puzzle, guess, skip = false) {
  if (state.done) return state;
  if (!skip && !normalize(guess)) throw new Error("Enter a player name.");
  const correct = !skip && matches(guess, puzzle.playerGuess);
  const attempts = [...state.attempts, { guess: skip ? "Skipped" : guess.trim().slice(0, 120), correct, skipped: skip }];
  return { ...state, attempts, done: correct || attempts.length === 5, won: correct, score: correct ? 6 - attempts.length : 0 };
}

export function guessLadder(state, puzzle, guess, skip = false) {
  if (state.done) return state;
  if (!skip && !normalize(guess)) throw new Error("Enter your answer.");
  const question = puzzle.statLadder.questions[state.attempts.length];
  const correct = !skip && matches(guess, question);
  const attempts = [...state.attempts, { guess: skip ? "Skipped" : guess.trim().slice(0, 120), correct, skipped: skip }];
  const score = state.score + (correct ? attempts.length : 0);
  return { ...state, attempts, score, done: attempts.length === 5, won: attempts.length === 5 && score > 0 };
}

export function finishCrossword(state, model) {
  if (state.done) return state;
  const correct = model.cells.every((cell, index) => !cell || state.letters[index] === cell.letter);
  return { ...state, done: correct, won: correct, score: correct ? 1 : 0 };
}

export function streakStats(records, today = dateKey()) {
  const days = [...new Set(records.filter(r => r.mode === "daily" && r.done).map(r => r.date))].filter(validDate).sort();
  let best = 0, run = 0, previous = null;
  for (const day of days) {
    run = previous && shiftDate(previous, 1) === day ? run + 1 : 1;
    best = Math.max(best, run); previous = day;
  }
  let current = 0;
  let cursor = days.includes(today) ? today : shiftDate(today, -1);
  const set = new Set(days);
  while (set.has(cursor)) { current++; cursor = shiftDate(cursor, -1); }
  return { current, best, played: days.length };
}

export function shareScore(game, state, puzzle, mode = "daily", url = "") {
  const label = mode === "daily" ? puzzle.date : mode === "preview" ? "Owner preview" : "Practice";
  let score, blocks;
  if (game === "player") {
    score = `${state.score}/5`;
    blocks = [...state.attempts.map(a => a.correct ? "🟩" : a.skipped ? "⬜" : "🟥"), ...Array(5 - state.attempts.length).fill("⬛")].join("");
  } else if (game === "ladder") {
    score = `${state.score}/15`;
    blocks = state.attempts.map(a => a.correct ? "🟩" : a.skipped ? "⬜" : "🟥").join("");
  } else {
    score = state.done ? "Complete" : "In progress";
    blocks = `${state.reveals.length ? "🟨 Assisted" : "🟩 No reveals"} · ${state.checks} check${state.checks === 1 ? "" : "s"} · ${state.reveals.length} letter reveal${state.reveals.length === 1 ? "" : "s"}`;
  }
  return [`Daily Sports Games · ${label}`, `${GAME_NAMES[game]}: ${score}`, blocks, url].filter(Boolean).join("\n");
}

export function puzzleFingerprint(puzzle) {
  const value = JSON.stringify(puzzle);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}
