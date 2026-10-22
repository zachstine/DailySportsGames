import { dateKey, shiftDate, releaseTime, GAME_NAMES, GAMES, buildCrossword, validatePuzzle,
  guessPlayer, guessLadder, finishCrossword, streakStats, shareScore, shareSlate, stateFromRecordedResult,
  SolveTimer, validElapsedMs, formatDuration, gameScoreLabel, gamesForPuzzle, leagueOf, LEAGUES, LEAGUE_NAMES, normalize, newState } from "./core.js";
import { loadGame, saveGame, allResults, storageAvailable, resetPractice, readPreview,
  pendingResults, markResultRecorded, resultRecorded, setPlayerScope, getPlayerScope, importRecordedResults, readLocal, readPreviewContext } from "./storage.js";
import { configured, publishedEditions, getDailyPuzzle, recordDailyResult, connectPlayer, playerResultsForDate, ensurePlayerProfile } from "./firebase.js";
import { placeGrid, gridBank, startDrill, finishDrill, guessDrill } from "./new-games.js";
import { startRankedDrill, acceptRankedAnswer, publishDrillScore, drillLeaderboard } from "./leaderboard.js";
import { validCreatorName } from "./puzzles.js";

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
let puzzle, mode = "practice", states = {}, crossword, activeEntry = 0, activeCell = 0;
let loadedDate = dateKey(), shareText = "", sharingAll = false, toastTimer, busy = false, badLetters = new Set();
let practicePuzzle;
let syncingResults = false;
let playerConnection, playerUid = null, playerChangedDuringLoad = false;
const accountRevision = readLocal("account-revision");
const resultErrors = new Set();
let crossTimer = null, crossTimerScope = null;
let previewContext = null;
let games = [], selectedLeague = "general", editionOptions = ["general"];
let drillSubmitting = false, drillRanking = false, leaderboardDate = null, leaderboardRows = [], leaderboardError = "", leaderboardLoading = false;
const currentLeague = () => leagueOf(puzzle);
const hasStarted = (game, state) => game === "cross" ? state.letters.some(Boolean) : game === "grid" ? state.score > 0 || state.mistakes.some(Boolean) : game === "drill" ? state.startedAt !== null : state.attempts.length > 0;
const recorded = (game, date) => resultRecorded(game, date, getPlayerScope(), currentLeague());
const creditName = game => validCreatorName(puzzle?.credits?.[game]?.displayName) ? puzzle.credits[game].displayName : "";

function checkpointCrossTime(save = true) {
  if (!crossTimer || !puzzle || !states.cross || crossTimerScope !== getPlayerScope()) return;
  states.cross.elapsedMs = crossTimer.elapsed();
  if (save) saveGame("cross", puzzle, mode, states.cross);
}

function stopCrossTimer() {
  crossTimer?.pause(); checkpointCrossTime();
}

function syncCrossTimer() {
  if (!crossTimer) return;
  if (location.hash === "#cross" && !document.hidden && !states.cross.done && crossTimerScope === getPlayerScope()) crossTimer.start();
  else crossTimer.pause();
  checkpointCrossTime(); updateCrossTimer();
}

function updateCrossTimer() {
  const display = $("#cross-timer");
  if (display && states.cross) display.textContent = formatDuration(states.cross.elapsedMs);
}

async function getPractice() {
  if (!practicePuzzle) {
    const response = await fetch(new URL("../data/practice.json", import.meta.url));
    if (!response.ok) throw new Error("The practice slate could not be loaded. Please refresh.");
    practicePuzzle = await response.json();
    if (validatePuzzle(practicePuzzle).length) throw new Error("The practice puzzle file is invalid.");
  }
  return structuredClone(practicePuzzle);
}

function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message; $("#toast").hidden = false;
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 5000);
}

function showNotice(message, kind = "") {
  const el = $("#site-status");
  el.textContent = message; el.className = `notice ${kind}`; el.hidden = !message;
}

async function loadSlate(forcePractice = false) {
  if (busy) return;
  stopCrossTimer(); crossTimer = null;
  busy = true; puzzle = null; states = {}; loadedDate = dateKey(); previewContext = null;
  $("#home-view").hidden = true; $("#game-view").hidden = true; $("#unavailable-view").hidden = true;
  showNotice("Loading the slate…");
  try {
    const params = new URLSearchParams(location.search);
    selectedLeague = LEAGUES.includes(params.get("league")) ? params.get("league") : "general";
    if (params.has("preview") && !forcePractice) {
      puzzle = readPreview(); mode = "preview";
      previewContext = readPreviewContext();
      if (!puzzle || validatePuzzle(puzzle).length) throw new Error("The owner preview expired or is invalid. Return to the owner desk and preview again.");
      showNotice(previewContext ? "Puzzle preview · Test freely. Your daily scores and streaks are unaffected." : "Owner preview · Test freely. This doesn't count toward daily streaks.");
    } else if (forcePractice || params.has("practice") || !configured) {
      puzzle = await getPractice(); mode = "practice";
      showNotice(configured ? "Practice slate · Sample games. Daily streaks are unaffected." : "Demo mode · Try the practice games. Daily publishing opens when Firebase is connected.");
    } else {
      mode = "daily";
      editionOptions = await publishedEditions(loadedDate);
      if (!editionOptions.includes(selectedLeague)) selectedLeague = editionOptions.includes("general") ? "general" : editionOptions[0] || "general";
      try { puzzle = await getDailyPuzzle(loadedDate, selectedLeague); }
      catch (error) {
        if (error.code !== "permission-denied") throw error;
      }
      if (!puzzle) {
        puzzle = await getPractice(); mode = "practice";
        showNotice("Today's daily slate isn't available yet. Try the practice games below; practice doesn't count toward daily streaks.", "warning");
        const retry = document.createElement("button");
        retry.className = "text-button"; retry.dataset.action = "retry"; retry.textContent = "Check for today's games →";
        $("#site-status").append(" ", retry);
      } else showNotice("");
    }
    games = gamesForPuzzle(puzzle);
    if (mode !== "daily") editionOptions = [currentLeague()];
    $("#play-league").innerHTML = editionOptions.map(league => `<option value="${league}">${LEAGUE_NAMES[league]}</option>`).join("");
    $("#play-league").value = currentLeague();
    $("#play-league").disabled = mode !== "daily" || editionOptions.length < 2;
    $("#edition-note").textContent = mode === "daily" ? `${LEAGUE_NAMES[currentLeague()]} · ${games.length} daily games${editionOptions.length > 1 ? " · Switch editions for more" : ""}` : "Sample games · scores do not count toward daily streaks";
    crossword = buildCrossword(puzzle.crossSport);
    activeEntry = crossword.entries[0].id; activeCell = crossword.entries[0].positions[0]; badLetters.clear();
    for (const game of games) {
      states[game] = loadGame(game, puzzle, mode);
      if (mode === "daily" && states[game].done) saveGame(game, puzzle, mode, states[game]);
    }
    if (mode === "daily" && playerConnection?.auth.currentUser) {
      const uid = playerConnection.auth.currentUser.uid;
      try {
        const records = await playerResultsForDate(playerConnection, puzzle.date, currentLeague());
        if (uid !== playerUid) { playerChangedDuringLoad = true; return; }
        importRecordedResults(records);
        for (const record of records) {
          const state = states[record.game]; if (!state) continue;
          if (!state.done || state.score !== record.score || record.game === "cross" &&
            (state.checks !== record.checks || (state.revealCount ?? state.reveals.length) !== record.reveals || (state.elapsedMs ?? null) !== (record.elapsedMs ?? null))) {
            states[record.game] = stateFromRecordedResult(record, puzzle);
          }
          saveGame(record.game, puzzle, mode, states[record.game]);
        }
      } catch { /* Local play and queued scores still work during a network failure. */ }
    }
    if (states.drill && !states.drill.recordedOnly) { states.drill = finishDrill(states.drill, Date.now(), puzzle.twoMinuteDrill.answers.length); if (states.drill.done) saveGame("drill", puzzle, mode, states.drill); }
    crossTimerScope = getPlayerScope();
    if (!states.cross.done) crossTimer = new SolveTimer(states.cross.elapsedMs);
    $("#reset-practice").hidden = mode === "daily";
    if (!storageAvailable) showNotice("Browser storage is unavailable. Games work, but progress and streaks won't survive a refresh.", "warning");
    renderDashboard(); route();
    if (mode === "daily") flushResults();
  } catch (error) {
    showNotice("The slate couldn't be loaded.", "error");
    $("#unavailable-message").textContent = error.message || "We couldn't reach Firebase. Try again, or play the practice slate.";
    $("#unavailable-view").hidden = false;
  } finally {
    busy = false;
    if (playerChangedDuringLoad) { playerChangedDuringLoad = false; queueMicrotask(() => loadSlate(forcePractice)); }
  }
}

function renderDashboard() {
  if (!puzzle) return;
  const done = games.filter(game => states[game].done).length;
  $("#slate-label").textContent = mode === "daily" ? "THE DAILY SLATE" : mode === "preview" ? "OWNER PREVIEW" : "PRACTICE SLATE";
  $("#completed-count").innerHTML = `${done}<span>/${games.length}</span>`;
  $("#share-all-scores").disabled = done !== games.length;
  $("#slate-share-message").textContent = done === games.length ? `All ${games.length} games complete. Send your results in one text.` : `Finish all ${games.length} games to share your full slate. No spoilers.`;
  const longest = Math.max(0, ...games.map(game => streakStats(allResults().filter(r => r.game === game && leagueOf(r) === currentLeague()), loadedDate).current));
  $("#streak-summary").textContent = mode === "daily" ? longest ? `${longest}-day streak · Keep showing up` : "Your next daily ritual starts here" : mode === "preview" ? "Owner preview · No streaks recorded" : "Practice makes a sharper sports fan";
  $("#account-link").href = `./account.html${currentLeague() === "general" ? "" : `?league=${currentLeague()}`}`;
  $("#hero-game-count").textContent = `${games.length} games to put your sports brain to work.`;
  for (const game of GAMES) { const card = $(`[href="#${game}"].game-card`); if (card) { card.hidden = !games.includes(game); card.querySelector(".sport-chip").textContent = game === "drill" ? "120 SECONDS" : game === "grid" ? "9 NAMES" : currentLeague() === "general" ? "ALL SPORTS" : LEAGUE_NAMES[currentLeague()]; } }
  for (const game of games) {
    const state = states[game];
    $(`[data-card-status="${game}"]`).textContent = state.done ? game === "cross" ? `Completed${validElapsedMs(state.elapsedMs) ? ` · ${formatDuration(state.elapsedMs)}` : ""} · View result` : `Finished · ${gameScoreLabel(game, state)} ${game === "drill" ? "" : game === "grid" ? "matches" : "points"}` :
      hasStarted(game, state) ? "Continue playing" : mode === "daily" ? "Play today's game" : "Play practice game";
  }
}

function route() {
  if (!puzzle) return;
  syncCrossTimer();
  let game = location.hash.slice(1);
  if (mode === "preview" && previewContext && game !== previewContext.game) { game = previewContext.game; history.replaceState(null, "", `#${game}`); }
  const inGame = games.includes(game);
  $("#home-view").hidden = inGame; $("#game-view").hidden = !inGame; $("#unavailable-view").hidden = true;
  if (!inGame) { document.title = "Daily Sports Games — Your daily sports fix"; renderDashboard(); return; }
  document.title = `${GAME_NAMES[game]} — Daily Sports Games`;
  $("#game-title").textContent = GAME_NAMES[game];
  $("#game-credit").textContent = creditName(game) ? `Submitted by ${creditName(game)}` : "";
  $("#game-credit").hidden = !creditName(game);
  const back = $("#game-back-link");
  back.href = previewContext ? previewContext.href : "#";
  back.textContent = previewContext ? previewContext.href === "./create/" ? "← Back to puzzle creator" : "← Back to submission review" : "← All games";
  $("#game-edition").textContent = `${mode === "daily" ? puzzle.date : mode === "preview" ? previewContext ? "PUZZLE PREVIEW" : "OWNER PREVIEW" : "PRACTICE SLATE"} / ${currentLeague() === "general" ? "" : `${LEAGUE_NAMES[currentLeague()]} / `}${puzzle.title}`;
  $("#game-description").textContent = { player: "One player. Five clues. Can you call it from one telling fact?", ladder: "Five questions. One guess each. Climb from the obvious to the obscure.", cross: "A little sports knowledge goes a long way. Fill the grid, one cross at a time.", grid: "Nine names. Nine stats. Find the perfect match for every square.", drill: "One question. Unlimited guesses. Make every second count." }[game];
  if (game === "player") renderPlayer();
  if (game === "ladder") renderLadder();
  if (game === "cross") renderCross();
  if (game === "grid") renderGrid();
  if (game === "drill") { renderDrill(); if (mode === "daily" && leaderboardDate !== puzzle.date) refreshLeaderboard(); }
}

function persist(game) {
  if (game === "cross") checkpointCrossTime(false);
  if (!saveGame(game, puzzle, mode, states[game])) toast("Progress couldn't be saved on this device. Keep this page open to continue.");
  renderDashboard();
  if (mode === "daily" && states[game].done) flushResults();
}

function resultSyncMessage(game, date) {
  if (recorded(game, date)) return "Finish this edition to send full results. Result recorded online. Progress and streaks stay on this device.";
  if (resultErrors.has(`${getPlayerScope()}:${date}:${currentLeague()}:${game}`)) return "Saved on this device. Online score recording is unavailable; try again or return later.";
  return "Saved on this device · Recording your result…";
}

function refreshResultMessages() {
  for (const element of document.querySelectorAll("[data-result-sync]")) {
    element.textContent = resultSyncMessage(element.dataset.resultSync, element.dataset.resultDate);
  }
  for (const button of document.querySelectorAll('[data-action="retry-results"]')) {
    button.hidden = recorded(button.dataset.game, button.dataset.date);
    button.disabled = syncingResults;
  }
}

async function flushResults() {
  if (!configured || syncingResults || !playerUid) return;
  syncingResults = true; refreshResultMessages();
  const scope = getPlayerScope();
  const attempted = new Set();
  try {
    for (;;) {
      if (scope !== getPlayerScope()) break;
      const result = pendingResults(scope).find(r => !attempted.has(`${r.date}:${leagueOf(r)}:${r.game}`));
      if (!result) break;
      const key = `${result.date}:${leagueOf(result)}:${result.game}`;
      attempted.add(key); resultErrors.delete(`${scope}:${key}`); refreshResultMessages();
      try {
        await recordDailyResult(result, scope);
        markResultRecorded(result.game, result.date, scope, leagueOf(result));
      } catch { resultErrors.add(`${scope}:${key}`); }
      refreshResultMessages();
    }
  } finally {
    syncingResults = false; refreshResultMessages();
    if (scope !== getPlayerScope() && mode === "daily") queueMicrotask(flushResults);
  }
}

function answerForm(label, placeholder) {
  return `<form class="answer-form" id="answer-form"><label for="answer">${label}</label><div class="input-row"><input id="answer" name="answer" type="text" autocomplete="off" autocapitalize="words" spellcheck="false" maxlength="120" required placeholder="${placeholder}"><button class="button" type="submit">Lock it in <span aria-hidden="true">↗</span></button></div></form><div class="skip-row"><button class="text-button" data-action="skip">Skip this ${location.hash === "#player" ? "clue" : "question"} →</button><span>One guess. Make it count.</span></div>`;
}

function resultPanel(game, heading, description) {
  const state = states[game];
  const index = games.indexOf(game);
  const remaining = [...games.slice(index + 1), ...games.slice(0, index)];
  const nextGame = remaining.find(next => !states[next].done);
  const nextLink = previewContext ? `<a class="button secondary" href="${previewContext.href}">Back to ${previewContext.href === "./create/" ? "puzzle creator" : "submission review"}</a>` : nextGame
    ? `<a class="button secondary" href="#${nextGame}" aria-label="Next game: ${GAME_NAMES[nextGame]}">Next game →</a>`
    : `<a class="button secondary" href="#">View today's results</a>`;
  const sync = mode === "daily" ? `<p class="fine-print" role="status" data-result-sync="${game}" data-result-date="${puzzle.date}">${resultSyncMessage(game, puzzle.date)}</p><button class="text-button" data-action="retry-results" data-game="${game}" data-date="${puzzle.date}" ${recorded(game, puzzle.date) ? "hidden" : ""} ${syncingResults ? "disabled" : ""}>Retry score recording</button>` : "";
  const score = game === "cross" ? validElapsedMs(state.elapsedMs) ? `<div class="result-score">${formatDuration(state.elapsedMs)}<span class="result-time-label">SOLVE TIME</span></div>` : "" : `<div class="result-score">${state.score}<span>${game === "drill" ? ` answer${state.score === 1 ? "" : "s"}` : `/${game === "player" ? 5 : game === "ladder" ? 15 : 9}`}</span></div>`;
  const allDone = !previewContext && games.every(game => states[game].done);
  const shareAll = allDone ? `<button class="button" data-action="share-all">Share all scores ↗</button>` : "";
  const shareSingle = previewContext ? "" : `<button class="button${allDone ? " secondary" : ""}" data-action="share" data-game="${game}">Share your score ↗</button>`;
  return `<div class="result-panel"><p class="eyebrow">${mode === "daily" ? "DAILY RESULT" : mode === "preview" ? "PREVIEW RESULT" : "PRACTICE RESULT"}</p><h2>${heading}</h2>${creditName(game) ? `<p class="creator-credit">Submitted by ${escape(creditName(game))}</p>` : ""}${score}<p>${description}</p><div class="button-row">${shareAll}${shareSingle}${nextLink}</div>${sync}</div>`;
}

function renderPlayer() {
  const state = states.player;
  if (state.recordedOnly) { renderRecordedResult("player"); return; }
  const visible = state.done ? 5 : state.attempts.length + 1;
  const hints = puzzle.playerGuess.hints.map((hint, i) => `<li class="hint ${i >= visible ? "locked" : !state.done && i === visible - 1 ? "current" : ""}"><span class="hint-index">0${i + 1}</span><span>${i < visible ? escape(hint) : "Clue locked · Guess or skip to unlock"}</span></li>`).join("");
  $("#game-body").innerHTML = `<div class="play-panel"><div class="panel-meta"><span class="pill">THE MYSTERY PLAYER</span><span>${state.done ? "Final whistle" : `Clue ${visible} of 5 · ${6 - visible} point${6 - visible === 1 ? "" : "s"} available`}</span></div><ol class="clue-list">${hints}</ol>${state.done ? resultPanel("player", state.won ? "You called it." : "A tough one today.", `The player was <strong>${escape(puzzle.playerGuess.answer)}</strong>. ${mode === "daily" ? "Come back for a fresh player tomorrow." : "Practice results don't affect your streak."}`) : answerForm("Who's the player?", "Enter a player name")}${state.attempts.length ? `<ul class="attempt-list">${state.attempts.map((a, i) => `<li><span>Clue ${i + 1} · ${escape(a.guess)}</span><span class="${a.correct ? "correct-text" : "wrong-text"}">${a.correct ? "Correct ✓" : a.skipped ? "Skipped" : "Incorrect ×"}</span></li>`).join("")}</ul>` : ""}</div>`;
}

function renderLadder() {
  const state = states.ladder;
  if (state.recordedOnly) { renderRecordedResult("ladder"); return; }
  const current = state.attempts.length;
  const question = puzzle.statLadder.questions[current];
  const rungs = Array.from({ length: 5 }, (_, i) => `<span class="rung ${state.attempts[i] ? state.attempts[i].correct ? "correct" : "incorrect" : i === current ? "active" : ""}" aria-label="Rung ${i + 1}${state.attempts[i] ? state.attempts[i].correct ? ": correct" : ": missed" : ""}">${state.attempts[i] ? state.attempts[i].correct ? "✓" : "×" : i + 1}</span>`).join("");
  const previous = current ? puzzle.statLadder.questions[current - 1] : null;
  $("#game-body").innerHTML = `<div class="play-panel"><div class="panel-meta"><span class="pill">${state.done ? "THE TOP RUNG" : `${escape(question.sport)} · ${["WARM-UP", "GETTING WARMER", "IN THE WEEDS", "DEEP CUT", "EXPERT TERRITORY"][current]}`}</span><span>${state.score}/15 points</span></div><div class="rungs">${rungs}</div>${state.done ? resultPanel("ladder", state.score === 15 ? "A perfect climb." : state.score >= 9 ? "You know your numbers." : "That's a wrap.", `You got ${state.attempts.filter(a => a.correct).length} of 5 questions right. Each rung was worth a little more.`) : `${previous ? `<div class="last-answer">Last rung: <strong>${state.attempts[current - 1].correct ? "Correct ✓" : "Missed"}</strong> · ${escape(previous.answer)}</div>` : ""}<p class="eyebrow">RUNG ${current + 1} / 5 · WORTH ${current + 1} POINT${current ? "S" : ""}</p><h2 class="stat-question">${escape(question.question)}</h2>${answerForm("Your answer", "Enter a name")}`}${state.done ? `<div class="answer-review"><p class="eyebrow">THE ANSWER SHEET</p>${puzzle.statLadder.questions.map((q, i) => `<details><summary>${state.attempts[i].correct ? "✓" : "×"} Rung ${i + 1} · ${escape(q.answer)}</summary><p>${escape(q.question)}</p><p>Your answer: ${escape(state.attempts[i].guess)}</p><a href="${escape(q.source)}" target="_blank" rel="noopener noreferrer">Check the source ↗</a></details>`).join("")}</div>` : ""}</div>`;
}

function renderGrid() {
  const state = states.grid;
  if (state.recordedOnly) { renderRecordedResult("grid"); return; }
  const mistakes = state.mistakes.reduce((a, b) => a + b, 0);
  const bank = gridBank(puzzle).map(name => `<button type="button" class="bank-name ${state.selected === name ? "selected" : ""}" data-bank-name="${name}" aria-pressed="${state.selected === name}" ${state.placements.includes(name) ? "disabled" : ""}>${escape(puzzle.gridIron.names[name])}${state.placements.includes(name) ? " ✓" : ""}</button>`).join("");
  const cells = puzzle.gridIron.cells.map((cell, i) => `<button type="button" class="match-cell ${state.placements[i] !== null ? state.mistakes[i] ? "matched assisted" : "matched" : ""}" data-match-cell="${i}" ${state.placements[i] !== null || state.done ? "disabled" : ""} aria-label="Row ${Math.floor(i / 3) + 1}, column ${i % 3 + 1}: ${escape(cell.clue)}${state.placements[i] !== null ? `, matched ${escape(cell.answer)}` : ""}"><span class="match-position">0${i + 1}</span><span class="match-clue">${escape(cell.clue)}</span>${state.placements[i] !== null ? `<strong>${escape(cell.answer)} ✓</strong>` : `<span class="match-empty">${state.selected !== null ? "Place selected name +" : "Choose a name below"}</span>`}</button>`).join("");
  $("#game-body").innerHTML = `<div class="play-panel"><div class="panel-meta"><span class="pill">THE MATCHUP</span><span>${state.score}/9 matched · ${mistakes} miss${mistakes === 1 ? "" : "es"}</span></div><p class="match-instruction" role="status">${state.done ? "Every name is in its place." : state.selected === null ? "Pick a name from the bank, then tap its matching square." : `Selected: ${escape(puzzle.gridIron.names[state.selected])}. Choose a square.`}</p><div class="match-grid">${cells}</div>${state.done ? resultPanel("grid", mistakes ? "A complete lineup." : "A perfect matchup.", `All nine matched · ${mistakes} miss${mistakes === 1 ? "" : "es"}. Green squares were solved first try; yellow squares took another guess.`) : `<div class="bank-heading"><h2>Your starting nine</h2><span>${9 - state.score} left</span></div><div class="name-bank">${bank}</div><p class="fine-print">Correct matches lock in. Misses stay open. Unlimited retries.</p>`}</div>`;
}

function leaderboardPanel() {
  if (mode !== "daily") return `<section class="leaderboard"><div class="bank-heading"><h2>The daily leaderboard</h2><span>DAILY ONLY</span></div><p class="fine-print">Practice and previews are unranked. Published daily Drills rank signed-in players by unique answers; ties share a place.</p></section>`;
  return `<section class="leaderboard"><div class="bank-heading"><h2>Today’s leaderboard</h2><button class="text-button" data-action="refresh-leaderboard" ${leaderboardLoading ? "disabled" : ""}>${leaderboardLoading ? "Loading…" : "Refresh ↻"}</button></div><p class="fine-print">Top 25 · Unique answers · Ties share a place · Public nicknames only</p>${leaderboardError ? `<p class="notice warning" role="status">${escape(leaderboardError)}</p>` : leaderboardRows.length ? `<table class="leaderboard-table"><caption class="sr-only">Two Minute Drill daily leaderboard</caption><thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">Answers</th></tr></thead><tbody>${leaderboardRows.map(row => `<tr class="${row.id === playerUid ? "your-rank" : ""}"><td>${row.rank === 1 ? "🥇" : `#${row.rank}`}</td><td>${escape(row.displayName)}${row.id === playerUid ? " (you)" : ""}</td><td>${row.score}</td></tr>`).join("")}</tbody></table>` : `<p class="leaderboard-empty">${leaderboardLoading ? "Loading today’s results…" : "The field is open. Finish a ranked run to set the pace."}</p>`}</section>`;
}

function renderDrill() {
  const state = states.drill, data = puzzle.twoMinuteDrill;
  const remaining = state.startedAt === null ? 120000 : Math.max(0, state.deadline - Date.now());
  const user = playerConnection?.auth.currentUser, canRank = mode === "daily" && user && !user.isAnonymous;
  const found = state.found || [];
  const review = state.done && !state.recordedOnly ? `<div class="drill-review"><h2>The answer sheet</h2><ul>${data.answers.map(answer => `<li class="${found.includes(normalize(answer.answer)) ? "found" : "missed"}"><span aria-hidden="true">${found.includes(normalize(answer.answer)) ? "✓" : "—"}</span> ${escape(answer.answer)}</li>`).join("")}</ul></div>` : "";
  let body;
  if (state.done) body = `${resultPanel("drill", state.score === data.answers.length ? "You cleared the field." : "That’s the final whistle.", `${state.score} unique answer${state.score === 1 ? "" : "s"} in two minutes.${state.ranked ? " Your ranked run is final." : ""}`)}${state.ranked ? `<p class="fine-print" role="status">${escape(state.rankMessage || "Submitting your leaderboard score…")}</p>${state.rankPosted ? "" : '<button class="button secondary" data-action="post-drill-score">Retry leaderboard submission</button>'}` : ""}${review}`;
  else if (state.startedAt === null) body = `<div class="drill-start"><p>Read the question. Hit start when you’re ready. Guess as many unique answers as possible before the clock runs out.</p><ul><li>Unlimited guesses · no penalty for a miss</li><li>Repeated answers count once</li><li>The timer keeps running through tab switches and reloads</li></ul>${canRank ? `<div class="field"><label for="drill-nickname">Public leaderboard nickname</label><input id="drill-nickname" maxlength="24" autocomplete="nickname" value="${escape(readLocal(`drill-name:${user.uid}`, ""))}" placeholder="e.g. SportsFan24"><p class="fine-print">Choose 2–24 letters, numbers, spaces, dots, underscores, or hyphens. Your email and account name stay private.</p></div><div class="button-row"><button class="button" data-action="start-drill-ranked" ${drillRanking ? "disabled" : ""}>${drillRanking ? "Connecting your clock…" : "Start ranked run →"}</button><button class="button secondary" data-action="start-drill" ${drillRanking ? "disabled" : ""}>Play unranked</button></div>` : `<div class="button-row"><button class="button" data-action="start-drill">Start 2:00 clock →</button>${mode === "daily" ? '<a class="button secondary" href="./account.html">Sign in to rank</a>' : ""}</div>`}<p class="fine-print">One daily attempt per player. ${canRank ? "Starting again resumes your existing ranked run." : mode === "daily" ? "Guest scores stay unranked." : "Reset practice to try again."}</p></div>`;
  else body = `<form id="drill-form" class="answer-form"><label for="drill-answer">Name an answer</label><div class="input-row"><input id="drill-answer" maxlength="120" required autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="Keep them coming…" ${drillSubmitting || !remaining ? "disabled" : ""}><button class="button" type="submit" ${drillSubmitting || !remaining ? "disabled" : ""}>${drillSubmitting ? "Checking…" : "Submit ↗"}</button></div></form><p id="drill-feedback" class="drill-feedback" role="status">${escape(state.feedback || "The clock is running. Go!")}</p><div class="drill-found"><h2>On the board <span>${state.score}</span></h2><div class="found-names">${found.map(key => `<span>✓ ${escape(data.answers.find(answer => normalize(answer.answer) === key)?.answer || key)}</span>`).join("") || '<p class="fine-print">Your correct answers will appear here.</p>'}</div></div>`;
  $("#game-body").innerHTML = `<div class="play-panel drill-panel"><div class="panel-meta"><span class="pill">${state.ranked ? "RANKED RUN" : mode === "daily" ? "DAILY DRILL" : "PRACTICE DRILL"}</span><span>${state.score} answer${state.score === 1 ? "" : "s"}</span></div><div class="drill-clock ${remaining <= 30000 && !state.done ? "clock-urgent" : ""}"><span>${state.done ? "FINAL WHISTLE" : "TIME REMAINING"}</span><strong id="drill-timer" role="timer" aria-live="off">${state.done ? "00:00" : formatDuration(Math.ceil(remaining / 1000) * 1000)}</strong><div class="clock-track"><i id="drill-clock-fill" style="width:${state.done ? 0 : remaining / 1200}%"></i></div></div><p class="eyebrow">THE QUESTION</p><h2 class="drill-question">${escape(data.question)}</h2>${body}<div id="leaderboard-panel">${leaderboardPanel()}</div></div>`;
}

async function refreshLeaderboard() {
  if (mode !== "daily" || !puzzle?.twoMinuteDrill || leaderboardLoading) return;
  const date = puzzle.date; if (leaderboardDate !== date) leaderboardRows = []; leaderboardDate = date; leaderboardLoading = true; leaderboardError = "";
  if (location.hash === "#drill" && $("#leaderboard-panel")) $("#leaderboard-panel").innerHTML = leaderboardPanel();
  try {
    const connection = playerConnection || await connectPlayer();
    const rows = await drillLeaderboard(connection, date);
    if (puzzle?.date === date) leaderboardRows = rows;
  } catch { leaderboardError = "Leaderboard could not load. Your game still works. Try Refresh."; }
  finally { leaderboardLoading = false; if (location.hash === "#drill" && puzzle?.date === date && states.drill && $("#leaderboard-panel")) $("#leaderboard-panel").innerHTML = leaderboardPanel(); }
}

async function startDrillRun(ranked) {
  if (!states.drill || states.drill.done || states.drill.startedAt !== null || drillRanking) return;
  if (!ranked) { states.drill = startDrill(states.drill); persist("drill"); renderDrill(); $("#drill-answer")?.focus(); return; }
  const nickname = $("#drill-nickname")?.value.trim(), activePuzzle = puzzle, uid = playerUid;
  if (!validCreatorName(nickname)) { toast("Choose a public nickname of 2–24 letters, numbers, spaces, dots, underscores, or hyphens."); return; }
  drillRanking = true; writeLocal(`drill-name:${uid}`, nickname); renderDrill();
  try {
    const run = await startRankedDrill(playerConnection, puzzle.date, nickname);
    if (puzzle !== activePuzzle || playerUid !== uid) return;
    states.drill = finishDrill({ ...newState("drill", puzzle), startedAt: run.startedAt, deadline: run.deadline, found: run.found, score: run.found.length, ranked: true }, Date.now(), puzzle.twoMinuteDrill.answers.length);
    persist("drill"); if (states.drill.done) postDrillScore();
  } catch (error) { toast(error.code === "permission-denied" ? "The ranked clock could not start. Check your connection or try unranked play." : error.message); }
  finally { drillRanking = false; if (puzzle === activePuzzle && location.hash === "#drill") { renderDrill(); $("#drill-answer")?.focus(); } }
}

async function submitDrillGuess() {
  if (drillSubmitting || !states.drill || states.drill.done) return;
  const input = $("#drill-answer"), guess = input?.value || "", activePuzzle = puzzle, uid = playerUid;
  try {
    const result = guessDrill(states.drill, puzzle, guess);
    if (result.outcome === "correct" && states.drill.ranked) {
      drillSubmitting = true; input.disabled = true; $("#drill-form button").disabled = true;
      const found = await acceptRankedAnswer(playerConnection, puzzle.date, result.key, uid);
      if (puzzle !== activePuzzle || playerUid !== uid) return;
      result.state = finishDrill({ ...states.drill, found, score: found.length }, Date.now(), puzzle.twoMinuteDrill.answers.length);
    }
    states.drill = { ...result.state, feedback: result.outcome === "correct" ? "Correct! Keep going." : result.outcome === "duplicate" ? "Already on your board. Try another." : result.outcome === "finished" ? "Time’s up." : "Not on today’s list. Keep guessing." };
    persist("drill"); renderDrill();
    if (states.drill.done && states.drill.ranked) postDrillScore(); else $("#drill-answer")?.focus();
  } catch (error) { toast(error.code === "permission-denied" ? "That answer could not be recorded before the server deadline. Try again if time remains." : error.message || "Connection interrupted. Try this answer again; the clock continues."); }
  finally { drillSubmitting = false; if (puzzle === activePuzzle && location.hash === "#drill") { renderDrill(); $("#drill-answer")?.focus(); } }
}

async function postDrillScore() {
  const state = states.drill, activePuzzle = puzzle, uid = playerUid;
  if (!state?.done || !state.ranked || state.rankPosted || state.rankPosting) return;
  state.rankPosting = true;
  try {
    const verified = await publishDrillScore(playerConnection, puzzle.date, uid);
    if (puzzle !== activePuzzle || playerUid !== uid) return;
    state.found = verified.found; state.score = verified.score; state.won = verified.score > 0;
    state.rankPosted = true; state.rankMessage = "Your ranked score is saved. The board shows today’s top 25."; refreshLeaderboard();
  } catch { state.rankMessage = "Your run is saved. Leaderboard submission is pending; use Retry when connected."; }
  finally { state.rankPosting = false; if (puzzle === activePuzzle) { persist("drill"); if (location.hash === "#drill") renderDrill(); } }
}

function tickDrill() {
  const state = states.drill;
  if (!state || state.recordedOnly || state.startedAt === null) return;
  if (state.done) { if (state.ranked && !state.rankPosted && !state.rankMessage) postDrillScore(); return; }
  const remaining = Math.max(0, state.deadline - Date.now());
  if ($( "#drill-timer")) {
    $("#drill-timer").textContent = formatDuration(Math.ceil(remaining / 1000) * 1000);
    $("#drill-clock-fill").style.width = `${remaining / 1200}%`;
    $("#drill-timer").closest(".drill-clock").classList.toggle("clock-urgent", remaining <= 30000);
  }
  if (!remaining && !drillSubmitting) { states.drill = finishDrill(state); persist("drill"); if (location.hash === "#drill") renderDrill(); if (state.ranked) postDrillScore(); }
}

function selectedEntry() { return crossword.entries.find(entry => entry.id === activeEntry) || crossword.entries[0]; }

function renderCross() {
  const state = states.cross;
  if (state.recordedOnly) { renderRecordedResult("cross"); return; }
  const cells = crossword.cells.map((cell, index) => cell ? `<div class="cross-cell ${state.reveals.includes(index) ? "revealed" : ""}" data-cell="${index}">${cell.number ? `<span aria-hidden="true">${cell.number}</span>` : ""}<input type="text" data-letter="${index}" value="${escape(state.letters[index])}" maxlength="1" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Row ${Math.floor(index / crossword.size) + 1}, column ${index % crossword.size + 1}${cell.number ? `, clue ${cell.number}` : ""}" aria-describedby="active-clue" ${state.done ? "readonly" : ""} tabindex="${index === activeCell ? "0" : "-1"}"></div>` : `<div class="cross-cell black" aria-hidden="true"></div>`).join("");
  const clues = direction => `<div><h3 class="${direction === "down" ? "down-heading" : ""}">${direction === "across" ? "Across" : "Down"}</h3>${crossword.entries.filter(e => e.direction === direction).sort((a, b) => a.number - b.number).map(e => `<button class="clue-button" data-clue="${e.id}"><strong>${e.number}</strong><span>${escape(e.clue)} (${e.answer.length})</span></button>`).join("")}</div>`;
  $("#game-body").innerHTML = `<div class="play-panel"><div class="panel-meta"><span class="pill">${crossword.size} × ${crossword.size} MINI</span><div class="cross-meta"><span>${crossword.entries.length} clues</span><span class="cross-clock">${state.done ? "Final time" : "Time"} <strong id="cross-timer" role="timer" aria-label="Elapsed solve time" aria-live="off">${formatDuration(state.elapsedMs)}</strong></span></div></div><div id="active-clue" class="cross-active-clue" aria-live="polite"></div><div class="cross-layout"><div><div class="cross-grid" style="grid-template-columns:repeat(${crossword.size},1fr);--cross-letter:${Math.max(14, Math.floor(130 / crossword.size))}px">${cells}</div><p id="cross-progress" class="cross-progress"></p>${state.done ? "" : `<div class="cross-tools"><button class="button secondary" data-action="check-cross">Check grid</button><button class="button secondary" data-action="reveal-cross">Reveal a letter</button></div>`}<p class="cross-footnote">The timer pauses away from this crossword. Time, checks, and reveals appear in your shared result.</p></div><div class="cross-clues">${clues("across")}${clues("down")}</div></div><div id="cross-result">${state.done ? crossResult() : ""}</div></div>`;
  paintCross();
}

function renderRecordedResult(game) {
  const state = states[game];
  const description = game === "cross"
    ? `${state.checks} grid check${state.checks === 1 ? "" : "s"} · ${state.revealCount} letter reveal${state.revealCount === 1 ? "" : "s"}.`
    : "Your completed score is saved to this account. Come back tomorrow for a fresh game.";
  $("#game-body").innerHTML = `<div class="play-panel">${resultPanel(game, "Today's result is saved.", description)}<p class="fine-print">Loaded from your saved score. Individual guesses and grid letters stay on the device where you played.</p></div>`;
}

function crossResult() {
  const state = states.cross;
  return resultPanel("cross", state.reveals.length ? "Every square in its place." : "Connected the dots.", `${state.checks} grid check${state.checks === 1 ? "" : "s"} · ${state.reveals.length} letter reveal${state.reveals.length === 1 ? "" : "s"}. ${state.reveals.length ? "Assisted solve." : "Solved without reveals."}`);
}

function paintCross(focus = false) {
  const state = states.cross, entry = selectedEntry();
  $("#active-clue").innerHTML = `<strong>${entry.number} ${entry.direction === "across" ? "Across" : "Down"}</strong>${escape(entry.clue)} (${entry.answer.length})`;
  for (const el of document.querySelectorAll("[data-cell]")) {
    const i = +el.dataset.cell;
    el.classList.toggle("in-word", entry.positions.includes(i));
    el.classList.toggle("active", i === activeCell);
    el.classList.toggle("incorrect", badLetters.has(i));
    el.classList.toggle("revealed", state.reveals.includes(i));
    const input = el.querySelector("input"); input.value = state.letters[i]; input.tabIndex = i === activeCell ? 0 : -1;
    input.setAttribute("aria-invalid", String(badLetters.has(i)));
  }
  for (const el of document.querySelectorAll("[data-clue]")) {
    el.classList.toggle("active", +el.dataset.clue === activeEntry);
    el.setAttribute("aria-pressed", String(+el.dataset.clue === activeEntry));
  }
  $("#cross-progress").textContent = `${crossword.cells.filter((c, i) => c && state.letters[i]).length}/${crossword.cells.filter(Boolean).length} squares filled · ${state.checks} checks · ${state.reveals.length} reveals`;
  if (focus) { const input = $(`[data-letter="${activeCell}"]`); input?.focus({ preventScroll: true }); input?.select(); }
}

function chooseCell(index, toggle = false) {
  const choices = crossword.cells[index].entries;
  if (toggle && index === activeCell && choices.length > 1) activeEntry = choices.find(id => id !== activeEntry);
  else if (!choices.includes(activeEntry)) activeEntry = choices[0];
  activeCell = index; paintCross(true);
}

function finishOrPaint() {
  checkpointCrossTime(false);
  states.cross = finishCrossword(states.cross, crossword);
  if (states.cross.done) crossTimer?.pause();
  persist("cross");
  if (states.cross.done) { renderCross(); toast("CrossSport complete. Nice solve!"); }
  else paintCross(true);
}

function moveInWord(step) {
  const positions = selectedEntry().positions;
  activeCell = positions[Math.max(0, Math.min(positions.length - 1, positions.indexOf(activeCell) + step))];
}

function handleLetter(input) {
  if (states.cross.done) return;
  activeCell = +input.dataset.letter;
  const letter = input.value.toUpperCase().replace(/[^A-Z]/g, "").slice(-1);
  states.cross.letters[activeCell] = letter; badLetters.delete(activeCell);
  if (letter) moveInWord(1);
  finishOrPaint();
}

document.addEventListener("input", event => {
  if (event.target.matches("[data-letter]")) handleLetter(event.target);
});

document.addEventListener("paste", event => {
  if (!event.target.matches("[data-letter]") || states.cross.done) return;
  event.preventDefault();
  const letters = event.clipboardData.getData("text").toUpperCase().replace(/[^A-Z]/g, "");
  const positions = selectedEntry().positions;
  const start = positions.indexOf(+event.target.dataset.letter);
  for (let i = 0; i < letters.length && start + i < positions.length; i++) {
    states.cross.letters[positions[start + i]] = letters[i]; badLetters.delete(positions[start + i]); activeCell = positions[start + i];
  }
  finishOrPaint();
});

document.addEventListener("keydown", event => {
  if (!event.target.matches("[data-letter]") || states.cross.done) return;
  activeCell = +event.target.dataset.letter;
  if (event.key === "Backspace") {
    event.preventDefault();
    if (!states.cross.letters[activeCell]) moveInWord(-1);
    states.cross.letters[activeCell] = ""; badLetters.delete(activeCell); persist("cross"); paintCross(true); return;
  }
  const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -crossword.size, ArrowDown: crossword.size };
  if (event.key in steps) {
    event.preventDefault();
    const step = steps[event.key];
    let next = activeCell + step;
    while (next >= 0 && next < crossword.cells.length) {
      if (Math.abs(step) === 1 && Math.floor(next / crossword.size) !== Math.floor(activeCell / crossword.size)) break;
      if (crossword.cells[next]) {
        const direction = Math.abs(step) === 1 ? "across" : "down";
        activeEntry = crossword.cells[next].entries.find(id => crossword.entries.find(e => e.id === id).direction === direction) ?? crossword.cells[next].entries[0];
        activeCell = next; paintCross(true); break;
      }
      next += step;
    }
  } else if (event.key === " " || event.key === "Enter") { event.preventDefault(); chooseCell(activeCell, true); }
});

document.addEventListener("submit", event => {
  if (event.target.id === "drill-form") { event.preventDefault(); submitDrillGuess(); return; }
  if (event.target.id !== "answer-form") return;
  event.preventDefault(); submitGuess(false);
});

function submitGuess(skip) {
  const game = location.hash.slice(1);
  const input = $("#answer");
  if (!["player", "ladder"].includes(game) || !input) return;
  try {
    states[game] = game === "player" ? guessPlayer(states[game], puzzle, input.value, skip) : guessLadder(states[game], puzzle, input.value, skip);
    persist(game); route();
    if (!states[game].done) $("#answer")?.focus({ preventScroll: true });
  } catch (error) { toast(error.message); input.focus(); }
}

function showStats() {
  const records = allResults().filter(r => leagueOf(r) === currentLeague());
  $("#stats-content").innerHTML = `<table class="stats-table"><caption>Daily results · ${LEAGUE_NAMES[currentLeague()]} · ${dateKey()}</caption><thead><tr><th scope="col">Game</th><th scope="col">Today's score</th><th scope="col">Streak</th><th scope="col">Best streak</th><th scope="col">Days played</th></tr></thead><tbody>${games.map(game => {
    const stats = streakStats(records.filter(r => r.game === game), dateKey());
    const state = mode === "daily" && puzzle?.date === dateKey() ? states[game] : null;
    const started = state && (state.done || hasStarted(game, state));
    const result = records.find(r => r.date === dateKey() && r.game === game && r.done) || (started ? state : null);
    return `<tr><td>${GAME_NAMES[game]}</td><td class="stats-score">${gameScoreLabel(game, result)}</td><td>${stats.current}</td><td>${stats.best}</td><td>${stats.played}</td></tr>`;
  }).join("")}</tbody></table>`;
  $("#stats-dialog").showModal();
}

document.addEventListener("click", async event => {
  const closer = event.target.closest("[data-close]");
  if (closer) { closer.closest("dialog").close(); return; }
  const name = event.target.closest("[data-bank-name]");
  if (name && states.grid && !states.grid.done) { states.grid.selected = +name.dataset.bankName; persist("grid"); renderGrid(); return; }
  const match = event.target.closest("[data-match-cell]");
  if (match && states.grid && !states.grid.done) {
    if (states.grid.selected === null) { toast("Pick a name from the bank first."); return; }
    const chosen = states.grid.selected;
    states.grid = placeGrid(states.grid, puzzle, +match.dataset.matchCell, chosen); persist("grid"); renderGrid();
    if (!states.grid.lastCorrect) { toast("Not that square. Keep the name selected and try another."); $(`[data-match-cell="${match.dataset.matchCell}"]`)?.focus({ preventScroll: true }); }
    else if (!states.grid.done) $("[data-bank-name]:not(:disabled)")?.focus({ preventScroll: true });
    return;
  }
  const clue = event.target.closest("[data-clue]");
  if (clue) {
    activeEntry = +clue.dataset.clue;
    activeCell = selectedEntry().positions.find(i => !states.cross.letters[i]) ?? selectedEntry().positions[0];
    paintCross(true); return;
  }
  const cell = event.target.closest("[data-letter]");
  if (cell) { chooseCell(+cell.dataset.letter, true); return; }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "start-drill") startDrillRun(false);
  if (action === "start-drill-ranked") startDrillRun(true);
  if (action === "refresh-leaderboard") refreshLeaderboard();
  if (action === "post-drill-score") postDrillScore();
  if (action === "instructions") $("#instructions-dialog").showModal();
  if (action === "stats") showStats();
  if (action === "skip") submitGuess(true);
  if (action === "retry") await loadSlate();
  if (action === "practice") {
    const url = new URL(location.href); url.search = "?practice=1"; url.hash = "";
    history.replaceState(null, "", url); await loadSlate(true);
  }
  if (action === "reset-practice" && puzzle && mode !== "daily") {
    resetPractice(puzzle, mode); await loadSlate(mode === "practice"); toast("Practice slate reset. Play again.");
  }
  if (action === "retry-results") flushResults();
  if (action === "share" || action === "share-all") {
    sharingAll = action === "share-all";
    const game = button.dataset.game;
    if (!puzzle || (sharingAll ? !games.every(game => states[game]?.done) : !states[game]?.done)) {
      toast(sharingAll ? "Finish all games in this edition to share your full slate." : "Finish this game to share its score."); return;
    }
    const url = new URL("./index.html", location.href); if (currentLeague() !== "general") url.searchParams.set("league", currentLeague()); url.hash = sharingAll ? "" : game;
    if (mode === "practice") url.searchParams.set("practice", "1");
    shareText = sharingAll ? shareSlate(states, puzzle, mode, mode === "preview" ? "" : url.href) : shareScore(game, states[game], puzzle, mode, mode === "preview" ? "" : url.href);
    $("#share-title").textContent = sharingAll ? "Your full slate." : "Your result.";
    $("#copy-share").textContent = sharingAll ? "Copy all scores" : "Copy score";
    $("#share-text").value = shareText; $("#share-text").rows = sharingAll ? Math.min(18, shareText.split("\n").length) : 6; $("#share-dialog").showModal();
  }
  if (action === "copy-share") {
    try { await navigator.clipboard.writeText(shareText); toast(sharingAll ? "All scores copied. Send them to the group chat." : "Score copied. Send it to the group chat."); }
    catch { $("#share-text").focus(); $("#share-text").select(); toast("Select and copy the score text above."); }
  }
  if (action === "native-share") {
    if (navigator.share) {
      try { await navigator.share({ text: shareText }); } catch (error) { if (error.name !== "AbortError") toast("Sharing wasn't available. Try the Copy button."); }
    } else { $("#share-text").focus(); $("#share-text").select(); toast("Select the text or use the Copy button to share it."); }
  }
  if (action === "check-cross" && !states.cross.done) {
    states.cross.checks++; badLetters.clear();
    crossword.cells.forEach((cell, i) => { if (cell && states.cross.letters[i] && states.cross.letters[i] !== cell.letter) badLetters.add(i); });
    persist("cross"); paintCross();
    toast(badLetters.size ? `${badLetters.size} incorrect letter${badLetters.size === 1 ? "" : "s"} highlighted.` : "No incorrect letters so far. Keep going!");
  }
  if (action === "reveal-cross" && !states.cross.done) {
    const positions = selectedEntry().positions;
    const index = positions.includes(activeCell) && states.cross.letters[activeCell] !== crossword.cells[activeCell].letter ? activeCell :
      positions.find(i => states.cross.letters[i] !== crossword.cells[i].letter);
    if (index === undefined) { toast("This word is already correct. Choose another clue to reveal a letter."); return; }
    states.cross.letters[index] = crossword.cells[index].letter;
    if (!states.cross.reveals.includes(index)) states.cross.reveals.push(index);
    badLetters.delete(index); activeCell = index; finishOrPaint();
  }
});

function tick() {
  // Background tabs may delay Firebase's auth event. Reopen the persisted
  // session after an explicit sign-in/out in another tab before resuming play.
  if (readLocal("account-revision") !== accountRevision) { stopCrossTimer(); location.reload(); return; }
  tickDrill();
  if (crossTimer?.running) { checkpointCrossTime(); updateCrossTimer(); }
  const today = dateKey();
  $("#today-date").dateTime = today;
  $("#today-date").textContent = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date());
  const seconds = Math.max(0, Math.floor((releaseTime(shiftDate(today, 1)) - Date.now()) / 1000));
  $("#reset-countdown").textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, "0")).join(":");
  if (today !== loadedDate && !busy && !(states.drill?.startedAt && !states.drill.done)) loadSlate();
}

window.addEventListener("hashchange", () => { route(); window.scrollTo({ top: 0, behavior: "instant" }); });
window.addEventListener("pageshow", event => { if (event.persisted) loadSlate(); });
window.addEventListener("online", () => { if (mode === "daily") flushResults(); });
document.addEventListener("visibilitychange", syncCrossTimer);
window.addEventListener("pagehide", stopCrossTimer);

async function initializePlayer() {
  if (!configured) return;
  setPlayerScope(readLocal("last-player"));
  try {
    playerConnection = await connectPlayer();
    const applyUser = user => {
      const nextScope = user?.uid || "local-guest";
      const changed = Boolean(puzzle) && getPlayerScope() !== nextScope;
      if (changed) stopCrossTimer();
      playerUid = user?.uid || null; setPlayerScope(nextScope);
      $("#account-link").textContent = !user || user.isAnonymous ? "Sign in" : "Account";
      if (changed) {
        if (busy) playerChangedDuringLoad = true; else loadSlate();
      }
      if (user && !user.isAnonymous) ensurePlayerProfile(playerConnection).catch(() => {});
    };
    applyUser(playerConnection.auth.currentUser);
    playerConnection.authModule.onAuthStateChanged(playerConnection.auth, applyUser);
  } catch { /* Firebase account access is optional; games stay playable locally. */ }
}

$("#play-league").addEventListener("change", async event => {
  const url = new URL(location.href); if (event.target.value === "general") url.searchParams.delete("league"); else url.searchParams.set("league", event.target.value); url.hash = "";
  history.replaceState(null, "", url); await loadSlate();
});
await initializePlayer(); await loadSlate(); tick(); setInterval(tick, 1000);
