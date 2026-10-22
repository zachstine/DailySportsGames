import { BASE_GAMES as GAMES, GAME_NAMES } from "./core.js";
import { blankGame, creatorName, gameEnvelope, previewSlate } from "./puzzles.js";
import { GameEditor, showErrors } from "./game-editor.js";
import { readLocal, writeLocal, writePreview, resetPractice } from "./storage.js";
import { configured, connectPlayer } from "./firebase.js";
import { submitCommunityPuzzle } from "./community.js";

const $ = selector => document.querySelector(selector);
const editor = new GameEditor($("#creator-editor"), "create");
let game = readLocal("creator-active-game", "player"), working = false;
if (!GAMES.includes(game)) game = "player";
function saveDraft() {
  writeLocal("creator-active-game", game);
  writeLocal(`creator-draft:${game}`, { data: editor.read(), name: $("#creator-name").value });
}
function chooseGame(next) {
  game = next; const draft = readLocal(`creator-draft:${game}`);
  $("#creator-name").value = draft?.name || "";
  try { editor.set(game, draft?.data || blankGame(game)); } catch { editor.set(game, blankGame(game)); }
  $("#creator-game-title").textContent = GAME_NAMES[game];
  for (const input of document.querySelectorAll('[name="creator-game"]')) input.checked = input.value === game;
  $("#creator-feedback").hidden = true; writeLocal("creator-active-game", game);
}
function controls() {
  $("#creator-submit").disabled = working || !configured;
  $("#creator-preview").disabled = working;
  $("#creator-fields").disabled = working;
}
function checkedEnvelope(requiredName) {
  const errors = editor.errors();
  let name = "";
  try { name = creatorName($("#creator-name").value, requiredName); } catch (error) { errors.unshift(error.message); }
  if (errors.length) { showErrors($("#creator-feedback"), errors); return null; }
  return gameEnvelope(game, editor.read(), name);
}
$("#creator-editor").addEventListener("game-edit", saveDraft);
$("#creator-name").addEventListener("input", saveDraft);
for (const input of document.querySelectorAll('[name="creator-game"]')) input.addEventListener("change", () => { saveDraft(); chooseGame(input.value); });
$("#creator-preview").addEventListener("click", async () => {
  const envelope = checkedEnvelope(false); if (!envelope) return;
  working = true; controls(); saveDraft();
  try {
    const puzzle = await previewSlate(game, envelope.data, envelope.creatorCredit);
    resetPractice(puzzle, "preview");
    if (!writePreview(puzzle, { href: "./create/", game })) throw new Error("Preview needs browser session storage. Keep this browser tab open and try again.");
    location.assign(`../index.html?preview=1#${game}`);
  } catch (error) { showErrors($("#creator-feedback"), [error.message]); }
  finally { working = false; controls(); }
});
$("#creator-form").addEventListener("submit", async event => {
  event.preventDefault(); if (working) return;
  if ($("#creator-website").value) { showErrors($("#creator-feedback"), ["The form couldn't be submitted. Please try again."]); return; }
  const envelope = checkedEnvelope(true); if (!envelope) return;
  working = true; controls(); saveDraft();
  $("#creator-feedback").hidden = false; $("#creator-feedback").className = "notice"; $("#creator-feedback").textContent = "Sending your puzzle for review…";
  try {
    const id = await submitCommunityPuzzle(await connectPlayer(), envelope);
    $("#creator-form").hidden = true; $("#creator-confirmation").hidden = false;
    $("#submission-reference").textContent = id; $("#submitted-game").textContent = GAME_NAMES[game];
    writeLocal(`creator-draft:${game}`, null); $("#creator-confirmation").focus();
  } catch (error) {
    const message = error.code === "permission-denied" ? "Your suggestion couldn't be saved. Please wait a minute before trying again; submissions are limited to five per day. Your draft is safe here." : error.message || "We couldn't reach the review queue. Your draft is saved; please try again.";
    showErrors($("#creator-feedback"), [message]);
  } finally { working = false; controls(); }
});
$("#create-another").addEventListener("click", () => { $("#creator-confirmation").hidden = true; $("#creator-form").hidden = false; chooseGame(game); window.scrollTo({ top: 0 }); });
chooseGame(game); controls();
if (!configured) showErrors($("#creator-feedback"), ["Submissions aren't connected in this local demo. You can still build and preview a puzzle."]);
