import { dateKey, shiftDate, releaseTime, GAME_NAMES, GAMES, buildCrossword, validatePuzzle,
  guessPlayer, guessLadder, finishCrossword, streakStats, shareScore, stateFromRecordedResult } from "./core.js";
import { loadGame, saveGame, allResults, storageAvailable, resetPractice, readPreview,
  pendingResults, markResultRecorded, resultRecorded, setPlayerScope, getPlayerScope, importRecordedResults, readLocal } from "./storage.js";
import { configured, getDailyPuzzle, recordDailyResult, connectPlayer, playerResultsForDate, ensurePlayerProfile } from "./firebase.js";

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
let puzzle, mode = "practice", states = {}, crossword, activeEntry = 0, activeCell = 0;
let loadedDate = dateKey(), shareText = "", toastTimer, busy = false, badLetters = new Set();
let practicePuzzle;
let syncingResults = false;
let playerConnection, playerUid = null, playerChangedDuringLoad = false;
const resultErrors = new Set();

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
  busy = true; puzzle = null; states = {}; loadedDate = dateKey();
  $("#home-view").hidden = true; $("#game-view").hidden = true; $("#unavailable-view").hidden = true;
  showNotice("Loading the slate…");
  try {
    const params = new URLSearchParams(location.search);
    if (params.has("preview") && !forcePractice) {
      puzzle = readPreview(); mode = "preview";
      if (!puzzle || validatePuzzle(puzzle).length) throw new Error("The owner preview expired or is invalid. Return to the owner desk and preview again.");
      showNotice("Owner preview · Test freely. This doesn't count toward daily streaks.");
    } else if (forcePractice || params.has("practice") || !configured) {
      puzzle = await getPractice(); mode = "practice";
      showNotice(configured ? "Practice slate · Sample games. Daily streaks are unaffected." : "Demo mode · Try all three practice games. Daily publishing opens when Firebase is connected.");
    } else {
      mode = "daily";
      try { puzzle = await getDailyPuzzle(loadedDate); }
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
    crossword = buildCrossword(puzzle.crossSport);
    activeEntry = crossword.entries[0].id; activeCell = crossword.entries[0].positions[0]; badLetters.clear();
    for (const game of GAMES) {
      states[game] = loadGame(game, puzzle, mode);
      if (mode === "daily" && states[game].done) saveGame(game, puzzle, mode, states[game]);
    }
    if (mode === "daily" && playerConnection?.auth.currentUser) {
      const uid = playerConnection.auth.currentUser.uid;
      try {
        const records = await playerResultsForDate(playerConnection, puzzle.date);
        if (uid !== playerUid) { playerChangedDuringLoad = true; return; }
        importRecordedResults(records);
        for (const record of records) {
          const state = states[record.game];
          if (!state.done || state.score !== record.score || record.game === "cross" &&
            (state.checks !== record.checks || (state.revealCount ?? state.reveals.length) !== record.reveals)) {
            states[record.game] = stateFromRecordedResult(record, puzzle);
          }
          saveGame(record.game, puzzle, mode, states[record.game]);
        }
      } catch { /* Local play and queued scores still work during a network failure. */ }
    }
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
  const done = GAMES.filter(game => states[game].done).length;
  $("#slate-label").textContent = mode === "daily" ? "THE DAILY SLATE" : mode === "preview" ? "OWNER PREVIEW" : "PRACTICE SLATE";
  $("#completed-count").innerHTML = `${done}<span>/3</span>`;
  const longest = Math.max(0, ...GAMES.map(game => streakStats(allResults().filter(r => r.game === game), loadedDate).current));
  $("#streak-summary").textContent = mode === "daily" ? longest ? `${longest}-day streak · Keep showing up` : "Your next daily ritual starts here" : mode === "preview" ? "Owner preview · No streaks recorded" : "Practice makes a sharper sports fan";
  for (const game of GAMES) {
    const state = states[game];
    $(`[data-card-status="${game}"]`).textContent = state.done ? game === "cross" ? "Completed · View result" : `Finished · ${state.score}/${game === "player" ? 5 : 15} points` :
      (game === "cross" ? state.letters.some(Boolean) : state.attempts.length) ? "Continue playing" : mode === "daily" ? "Play today's game" : "Play practice game";
  }
}

function route() {
  if (!puzzle) return;
  const game = location.hash.slice(1);
  const inGame = GAMES.includes(game);
  $("#home-view").hidden = inGame; $("#game-view").hidden = !inGame; $("#unavailable-view").hidden = true;
  if (!inGame) { document.title = "Daily Sports Games — Your daily sports fix"; renderDashboard(); return; }
  document.title = `${GAME_NAMES[game]} — Daily Sports Games`;
  $("#game-title").textContent = GAME_NAMES[game];
  $("#game-edition").textContent = `${mode === "daily" ? puzzle.date : mode === "preview" ? "OWNER PREVIEW" : "PRACTICE SLATE"} / ${puzzle.title}`;
  $("#game-description").textContent = { player: "One player. Five clues. Every clue makes the picture a little clearer.", ladder: "Five questions. One guess each. Climb from the obvious to the obscure.", cross: "A little sports knowledge goes a long way. Fill the grid, one connection at a time." }[game];
  if (game === "player") renderPlayer();
  if (game === "ladder") renderLadder();
  if (game === "cross") renderCross();
}

function persist(game) {
  if (!saveGame(game, puzzle, mode, states[game])) toast("Progress couldn't be saved on this device. Keep this page open to continue.");
  renderDashboard();
  if (mode === "daily" && states[game].done) flushResults();
}

function resultSyncMessage(game, date) {
  if (resultRecorded(game, date)) return "Result recorded online. Progress and streaks stay on this device.";
  if (resultErrors.has(`${getPlayerScope()}:${date}:${game}`)) return "Saved on this device. Online score recording is unavailable; try again or return later.";
  return "Saved on this device · Recording your result…";
}

function refreshResultMessages() {
  for (const element of document.querySelectorAll("[data-result-sync]")) {
    element.textContent = resultSyncMessage(element.dataset.resultSync, element.dataset.resultDate);
  }
  for (const button of document.querySelectorAll('[data-action="retry-results"]')) {
    button.hidden = resultRecorded(button.dataset.game, button.dataset.date);
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
      const result = pendingResults(scope).find(r => !attempted.has(`${r.date}:${r.game}`));
      if (!result) break;
      const key = `${result.date}:${result.game}`;
      attempted.add(key); resultErrors.delete(`${scope}:${key}`); refreshResultMessages();
      try {
        await recordDailyResult(result, scope);
        markResultRecorded(result.game, result.date, scope);
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
  const index = GAMES.indexOf(game);
  const remaining = [...GAMES.slice(index + 1), ...GAMES.slice(0, index)];
  const nextGame = remaining.find(next => !states[next].done);
  const nextLink = nextGame
    ? `<a class="button secondary" href="#${nextGame}" aria-label="Next game: ${GAME_NAMES[nextGame]}">Next game →</a>`
    : `<a class="button secondary" href="#">View today's results</a>`;
  const sync = mode === "daily" ? `<p class="fine-print" role="status" data-result-sync="${game}" data-result-date="${puzzle.date}">${resultSyncMessage(game, puzzle.date)}</p><button class="text-button" data-action="retry-results" data-game="${game}" data-date="${puzzle.date}" ${resultRecorded(game, puzzle.date) ? "hidden" : ""} ${syncingResults ? "disabled" : ""}>Retry score recording</button>` : "";
  return `<div class="result-panel"><p class="eyebrow">${mode === "daily" ? "DAILY RESULT" : mode === "preview" ? "OWNER PREVIEW RESULT" : "PRACTICE RESULT"}</p><h2>${heading}</h2>${game === "cross" ? "" : `<div class="result-score">${state.score}<span>/${game === "player" ? 5 : 15}</span></div>`}<p>${description}</p><div class="button-row"><button class="button" data-action="share" data-game="${game}">Share your score ↗</button>${nextLink}</div>${sync}</div>`;
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

function selectedEntry() { return crossword.entries.find(entry => entry.id === activeEntry) || crossword.entries[0]; }

function renderCross() {
  const state = states.cross;
  if (state.recordedOnly) { renderRecordedResult("cross"); return; }
  const cells = crossword.cells.map((cell, index) => cell ? `<div class="cross-cell ${state.reveals.includes(index) ? "revealed" : ""}" data-cell="${index}">${cell.number ? `<span aria-hidden="true">${cell.number}</span>` : ""}<input type="text" data-letter="${index}" value="${escape(state.letters[index])}" maxlength="1" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Row ${Math.floor(index / crossword.size) + 1}, column ${index % crossword.size + 1}${cell.number ? `, clue ${cell.number}` : ""}" aria-describedby="active-clue" ${state.done ? "readonly" : ""} tabindex="${index === activeCell ? "0" : "-1"}"></div>` : `<div class="cross-cell black" aria-hidden="true"></div>`).join("");
  const clues = direction => `<div><h3 class="${direction === "down" ? "down-heading" : ""}">${direction === "across" ? "Across" : "Down"}</h3>${crossword.entries.filter(e => e.direction === direction).sort((a, b) => a.number - b.number).map(e => `<button class="clue-button" data-clue="${e.id}"><strong>${e.number}</strong><span>${escape(e.clue)} (${e.answer.length})</span></button>`).join("")}</div>`;
  $("#game-body").innerHTML = `<div class="play-panel"><div class="panel-meta"><span class="pill">${crossword.size} × ${crossword.size} MINI</span><span>${crossword.entries.length} clues · Take your time</span></div><div id="active-clue" class="cross-active-clue" aria-live="polite"></div><div class="cross-layout"><div><div class="cross-grid" style="grid-template-columns:repeat(${crossword.size},1fr);--cross-letter:${Math.max(14, Math.floor(130 / crossword.size))}px">${cells}</div><p id="cross-progress" class="cross-progress"></p>${state.done ? "" : `<div class="cross-tools"><button class="button secondary" data-action="check-cross">Check grid</button><button class="button secondary" data-action="reveal-cross">Reveal a letter</button></div>`}<p class="cross-footnote">Checks and revealed letters appear in your shared result.</p></div><div class="cross-clues">${clues("across")}${clues("down")}</div></div><div id="cross-result">${state.done ? crossResult() : ""}</div></div>`;
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
  states.cross = finishCrossword(states.cross, crossword); persist("cross");
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
  const records = allResults();
  $("#stats-content").innerHTML = `<table class="stats-table"><thead><tr><th>Game</th><th>Streak</th><th>Best</th><th>Days played</th></tr></thead><tbody>${GAMES.map(game => {
    const stats = streakStats(records.filter(r => r.game === game), dateKey());
    return `<tr><td>${GAME_NAMES[game]}</td><td>${stats.current}</td><td>${stats.best}</td><td>${stats.played}</td></tr>`;
  }).join("")}</tbody></table>`;
  $("#stats-dialog").showModal();
}

document.addEventListener("click", async event => {
  const closer = event.target.closest("[data-close]");
  if (closer) { closer.closest("dialog").close(); return; }
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
  if (action === "share") {
    const game = button.dataset.game;
    const url = new URL("./index.html", location.href); url.hash = game;
    if (mode === "practice") url.searchParams.set("practice", "1");
    shareText = shareScore(game, states[game], puzzle, mode, mode === "preview" ? "" : url.href);
    $("#share-text").value = shareText; $("#share-dialog").showModal();
  }
  if (action === "copy-share") {
    try { await navigator.clipboard.writeText(shareText); toast("Score copied. Send it to the group chat."); }
    catch { $("#share-text").focus(); $("#share-text").select(); toast("Select and copy the score text above."); }
  }
  if (action === "native-share") {
    if (navigator.share) {
      try { await navigator.share({ text: shareText }); } catch (error) { if (error.name !== "AbortError") toast("Sharing wasn't available. Try Copy score."); }
    } else { $("#share-text").focus(); $("#share-text").select(); toast("Select the score or use Copy score to share it."); }
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
  const today = dateKey();
  $("#today-date").dateTime = today;
  $("#today-date").textContent = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date());
  const seconds = Math.max(0, Math.floor((releaseTime(shiftDate(today, 1)) - Date.now()) / 1000));
  $("#reset-countdown").textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, "0")).join(":");
  if (today !== loadedDate && !busy) loadSlate();
}

window.addEventListener("hashchange", () => { route(); window.scrollTo({ top: 0, behavior: "instant" }); });
window.addEventListener("pageshow", event => { if (event.persisted) loadSlate(); });
window.addEventListener("online", () => { if (mode === "daily") flushResults(); });

async function initializePlayer() {
  if (!configured) return;
  setPlayerScope(readLocal("last-player"));
  try {
    playerConnection = await connectPlayer();
    const applyUser = user => {
      const nextScope = user?.uid || "local-guest";
      const changed = Boolean(puzzle) && getPlayerScope() !== nextScope;
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

await initializePlayer(); await loadSlate(); tick(); setInterval(tick, 1000);
