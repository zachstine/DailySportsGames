import { dateKey, validDate, releaseTime, validatePuzzle, buildCrossword } from "./core.js";
import { getDraft, saveDraft, writePreview, readLocal, writeLocal } from "./storage.js";
import { configured, connectOwner, isOwner, loadOwnerPuzzle, saveOwnerPuzzle, upcomingPuzzles } from "./firebase.js";

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
let connection, authorized = false, revision = 0, revisionDate = null, dirty = false, writing = false, live = false, localTimer, toastTimer;
let current, sample, pendingImport = null;

function rememberRevision() {
  writeLocal("owner-last-date", $("#puzzle-date").value);
  if (revisionDate) writeLocal(`owner-revision:${revisionDate}`, { date: revisionDate, revision, live });
}

function message(value, warning = false) {
  $("#owner-status").textContent = value;
  $("#owner-status").className = `notice${warning ? " warning" : ""}`;
}

function toast(value) {
  clearTimeout(toastTimer); $("#toast").textContent = value; $("#toast").hidden = false;
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 5000);
}

function splitAliases(value) { return value.split(",").map(x => x.trim()).filter(Boolean); }

function renderFields(puzzle) {
  current = structuredClone(puzzle);
  $("#puzzle-date").value = puzzle.date; $("#puzzle-title").value = puzzle.title;
  writeLocal("owner-last-date", puzzle.date);
  $("#player-answer").value = puzzle.playerGuess.answer; $("#player-sport").value = puzzle.playerGuess.sport;
  $("#player-aliases").value = puzzle.playerGuess.aliases.join(", ");
  $("#hint-fields").innerHTML = puzzle.playerGuess.hints.map((hint, index) => `<div class="field"><label for="hint-${index}">Clue ${index + 1} · ${["Distinctive stat or fact", "Supporting detail", "Career context", "Team or era", "Signature clue"][index]}</label><textarea id="hint-${index}" maxlength="500" rows="2">${escape(hint)}</textarea></div>`).join("");
  $("#ladder-fields").innerHTML = puzzle.statLadder.questions.map((question, index) => `<div class="rung-editor" data-rung="${index}"><h3>Rung ${index + 1} · ${index + 1} point${index ? "s" : ""}</h3><div class="field"><label for="question-${index}">Question · ${["Easy", "Getting warmer", "Challenging", "Difficult", "Expert"][index]}</label><textarea id="question-${index}" maxlength="500" rows="2">${escape(question.question)}</textarea></div><div class="field-row"><div class="field"><label for="stat-answer-${index}">Answer</label><input id="stat-answer-${index}" maxlength="120" value="${escape(question.answer)}"></div><div class="field"><label for="stat-sport-${index}">Sport / league</label><input id="stat-sport-${index}" maxlength="30" value="${escape(question.sport)}"></div></div><div class="field"><label for="stat-aliases-${index}">Accepted aliases · comma separated</label><input id="stat-aliases-${index}" value="${escape(question.aliases.join(", "))}"></div><div class="field"><label for="stat-source-${index}">Source URL · https</label><input id="stat-source-${index}" type="url" value="${escape(question.source)}" placeholder="https://..."></div></div>`).join("");
  $("#cross-size").value = String(puzzle.crossSport.size);
  renderEntries(puzzle.crossSport.entries);
  dirty = false; setDocumentState(); paintGrid();
}

function renderEntries(entries) {
  $("#cross-fields").innerHTML = entries.map((entry, index) => `<div class="cross-entry" data-entry="${index}"><div class="cross-entry-top"><h3>Entry ${index + 1}</h3><button class="remove-entry" data-remove="${index}" aria-label="Remove crossword entry ${index + 1}">Remove</button></div><div class="field-row"><div class="field"><label for="cross-row-${index}">Row</label><input id="cross-row-${index}" data-prop="row" type="number" min="1" max="11" value="${entry.row + 1}"></div><div class="field"><label for="cross-col-${index}">Column</label><input id="cross-col-${index}" data-prop="col" type="number" min="1" max="11" value="${entry.col + 1}"></div><div class="field"><label for="cross-direction-${index}">Direction</label><select id="cross-direction-${index}" data-prop="direction"><option value="across" ${entry.direction === "across" ? "selected" : ""}>Across</option><option value="down" ${entry.direction === "down" ? "selected" : ""}>Down</option></select></div></div><div class="field"><label for="cross-answer-${index}">Answer</label><input id="cross-answer-${index}" data-prop="answer" maxlength="30" value="${escape(entry.answer)}"></div><div class="field"><label for="cross-clue-${index}">Clue</label><input id="cross-clue-${index}" data-prop="clue" maxlength="500" value="${escape(entry.clue)}"></div></div>`).join("");
}

function collect() {
  const questions = Array.from({ length: 5 }, (_, i) => ({ question: $(`#question-${i}`).value.trim(), answer: $(`#stat-answer-${i}`).value.trim(), sport: $(`#stat-sport-${i}`).value.trim(), aliases: splitAliases($(`#stat-aliases-${i}`).value), source: $(`#stat-source-${i}`).value.trim() }));
  const entries = [...document.querySelectorAll("[data-entry]")].map(element => {
    const value = prop => element.querySelector(`[data-prop="${prop}"]`).value;
    return { row: +value("row") - 1, col: +value("col") - 1, direction: value("direction"), answer: value("answer").trim(), clue: value("clue").trim() };
  });
  return {
    schemaVersion: 1, date: $("#puzzle-date").value, title: $("#puzzle-title").value.trim(),
    playerGuess: { answer: $("#player-answer").value.trim(), sport: $("#player-sport").value.trim(), aliases: splitAliases($("#player-aliases").value), hints: Array.from({ length: 5 }, (_, i) => $(`#hint-${i}`).value.trim()) },
    statLadder: { questions }, crossSport: { size: +$("#cross-size").value, entries }
  };
}

function paintGrid() {
  const model = buildCrossword(collect().crossSport);
  $("#editor-grid").style.gridTemplateColumns = `repeat(${model.size || 5}, 1fr)`;
  $("#editor-grid").innerHTML = model.cells ? model.cells.map(cell => cell ? `<div class="editor-square">${cell.number ? `<span>${cell.number}</span>` : ""}${cell.letter}</div>` : '<div class="editor-square black"></div>').join("") : "";
  $("#cross-grid-note").textContent = model.errors.length ? model.errors[0] : `${model.entries.length} connected entries. Numbering is automatic.`;
}

function setDocumentState(label) {
  $("#document-state").textContent = label || (live ? "Live · Locked" : dirty ? "Unsaved changes" : revisionDate ? `Firebase revision ${revision}` : "Local draft");
  $("#save-cloud").disabled = !authorized || writing || live;
  $("#publish").disabled = !authorized || writing || live;
  const changedDate = revisionDate && $("#puzzle-date").value !== revisionDate;
  $("#date-warning").hidden = !changedDate;
  if (changedDate) $("#date-warning").textContent = "Date changed. Use Load date before saving to Firebase so you don't overwrite an existing slate.";
  const date = $("#puzzle-date").value;
  try { $("#release-description").textContent = `Release: ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" }).format(releaseTime(date))} Eastern. Published games stay hidden until then.`; }
  catch { $("#release-description").textContent = "Choose a valid date to set the Eastern midnight release."; }
}

function validate(show = true) {
  const puzzle = collect();
  const errors = validatePuzzle(puzzle);
  if (show) $("#validation-result").innerHTML = errors.length ? `<ul class="validation-errors">${errors.map(error => `<li>${escape(error)}</li>`).join("")}</ul>` : '<p class="validation-success">✓ All three games passed validation. Preview the slate before publishing.</p>';
  return { puzzle, errors };
}

function changed(event) {
  if (!event.target.closest("#editor")) return;
  dirty = true; setDocumentState();
  if (event.target.closest("#cross-fields") || event.target.id === "cross-size") paintGrid();
  clearTimeout(localTimer);
  localTimer = setTimeout(() => {
    const data = collect();
    if (data.date && saveDraft(data)) $("#save-status").textContent = "Working copy autosaved on this device. Firebase is unchanged.";
  }, 600);
}

document.addEventListener("input", changed);
document.addEventListener("change", changed);

async function refreshSchedule() {
  if (!authorized) { toast("Sign in with an owner account to view Firebase slates."); return; }
  try {
    const list = await upcomingPuzzles(connection, dateKey());
    $("#schedule-list").innerHTML = list.length ? list.map(item => `<div class="schedule-item"><div><strong>${escape(item.date)}</strong><span>${item.published ? item.unlockAt.toMillis() <= Date.now() ? "Live · Locked" : "Scheduled" : "Private draft"}</span></div><button class="text-button" data-load="${escape(item.date)}">Open →</button></div>`).join("") : '<p class="fine-print">No upcoming slates. Save a draft or schedule your first date.</p>';
  } catch { toast("The Firebase schedule couldn't be loaded. Check your connection and owner rules."); }
}

async function loadDate() {
  if (writing) return;
  const date = $("#puzzle-date").value;
  if (!date) { toast("Choose a release date first."); return; }
  let cloud = null;
  try {
    if (authorized) cloud = await loadOwnerPuzzle(connection, date);
    revisionDate = authorized ? date : null; revision = cloud?.revision ?? 0;
    live = Boolean(cloud?.published && cloud.unlockAt.toMillis() <= Date.now());
    const imported = pendingImport?.date === date ? pendingImport : null;
    const data = imported || cloud?.puzzle || getDraft(date) || { ...structuredClone(sample), date };
    if (validatePuzzle(data).length) throw new Error("This stored draft is incomplete. Import a valid puzzle file or start from the sample.");
    renderFields(data);
    setDocumentState(live ? "Live · Locked" : cloud ? cloud.published ? "Scheduled" : "Firebase draft" : "New date · Local draft");
    $("#validation-result").textContent = "";
    $("#save-status").textContent = imported ? live ? "The imported file is in the editor, but this date is already live and locked. Choose a future date to publish it." : "Date checked. Your imported content is still in the editor, ready to validate and publish." : cloud ? live ? "This slate is live. Preview and export are available; publishing changes is locked." : "Loaded from Firebase." : "Loaded a local working copy. Nothing has been published.";
    if (authorized && imported) pendingImport = null;
    rememberRevision();
  } catch (error) { toast(error.message || "Couldn't load this date from Firebase."); }
}

async function publish(toPublic) {
  if (!authorized || writing) return;
  const { puzzle, errors } = validate();
  if (errors.length) { toast("Fix the validation errors before saving."); return; }
  if (puzzle.date !== revisionDate) { toast("Use Load date first, then review this slate before saving to Firebase."); return; }
  writing = true; setDocumentState();
  try {
    revision = await saveOwnerPuzzle(connection, puzzle, toPublic, revision);
    dirty = false; live = toPublic && releaseTime(puzzle.date) <= Date.now(); saveDraft(puzzle);
    rememberRevision();
    const label = toPublic ? live ? "Live · Locked" : "Scheduled" : "Firebase draft";
    setDocumentState(label);
    $("#save-status").textContent = toPublic ? live ? "Published. Today's games are now live." : `Scheduled for ${puzzle.date} at midnight Eastern.` : "Saved a private Firebase draft. Players cannot read it.";
    await refreshSchedule();
  } catch (error) { $("#save-status").textContent = error.code === "permission-denied" ? "Firebase rejected this write. Check owner access, rules, and whether this slate is already live." : error.message; }
  finally { writing = false; setDocumentState(); }
}

async function checkUser(user) {
  authorized = false;
  $("#owner-sign-in").hidden = Boolean(user); $("#sign-out").hidden = !user;
  $("#owner-identity").hidden = !user;
  if (user) {
    $("#owner-identity").textContent = `Signed in as ${user.email || user.uid} · UID: ${user.uid}`;
    try { authorized = await isOwner(connection, user.uid); }
    catch { message("Signed in, but owner access couldn't be checked. Publish firestore.rules and add owners/your-uid with enabled: true in the Firebase Console.", true); }
    if (authorized) {
      $("#owner-badge").textContent = "OWNER CONNECTED";
      message("Owner access verified. Load a date to edit its Firebase draft or prepare a new slate.");
      $("#connection-description").textContent = "Your owner account can read drafts and publish daily games.";
      await refreshSchedule();
    } else {
      $("#owner-badge").textContent = "NO PUBLISH ACCESS";
      message("This account isn't on the owner list. Add an owners document with your UID and enabled: true in the Firebase Console. The UID is shown below.", true);
    }
  } else {
    $("#owner-badge").textContent = "LOCAL WORKSPACE";
    message("Sign in to publish. Local editing, import, export, and preview are available now.");
    $("#schedule-list").innerHTML = '<p class="fine-print">Sign in with an owner account to see the schedule.</p>';
  }
  setDocumentState();
}

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.target.querySelector("button"); button.disabled = true;
  try {
    if (!connection) connection = await connectOwner();
    await connection.authModule.signInWithEmailAndPassword(connection.auth, $("#owner-email").value.trim(), $("#owner-password").value);
    $("#owner-password").value = "";
  } catch (error) {
    const messages = {
      "auth/invalid-credential": "Email or password wasn't recognized.",
      "auth/operation-not-allowed": "Enable Email/Password in Firebase Authentication first.",
      "auth/unauthorized-domain": "Add this website's hostname to Firebase Authentication's authorized domains.",
      "auth/too-many-requests": "Too many sign-in attempts. Wait a little before trying again."
    };
    message(messages[error.code] || "Sign-in couldn't finish. Check your Firebase config, account, and connection.", true);
  } finally { button.disabled = false; }
});

$("#google-sign-in").addEventListener("click", async event => {
  const button = event.currentTarget; button.disabled = true;
  try {
    if (!connection) connection = await connectOwner();
    const provider = new connection.authModule.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await connection.authModule.signInWithPopup(connection.auth, provider);
  } catch (error) {
    const messages = {
      "auth/operation-not-allowed": "Enable Google sign-in in Firebase Authentication first.",
      "auth/unauthorized-domain": "Add this website's hostname to Firebase Authentication's authorized domains.",
      "auth/popup-blocked": "Allow the sign-in popup for this site, then try again.",
      "auth/popup-closed-by-user": "Sign-in was canceled. Your local draft is safe.",
      "auth/account-exists-with-different-credential": "Use your existing email/password login for this owner account."
    };
    message(messages[error.code] || "Google sign-in couldn't finish. Check your Firebase provider settings and connection.", true);
  } finally { button.disabled = false; }
});

$("#sign-out").addEventListener("click", async () => {
  if (writing) return;
  try { await connection.authModule.signOut(connection.auth); }
  catch { toast("Sign-out didn't finish. Please try again."); }
});
$("#load-date").addEventListener("click", loadDate);
$("#refresh-schedule").addEventListener("click", refreshSchedule);
$("#validate").addEventListener("click", () => { validate(); paintGrid(); });
$("#save-cloud").addEventListener("click", () => publish(false));
$("#publish").addEventListener("click", () => publish(true));
$("#save-local").addEventListener("click", () => {
  const data = collect();
  if (!data.date) { toast("Choose a date before saving a working copy."); return; }
  if (saveDraft(data)) { dirty = false; setDocumentState("Local draft saved"); $("#save-status").textContent = "Saved on this device. Nothing has been published."; }
  else toast("Your browser couldn't save this draft. Export a JSON copy to keep it.");
});
$("#preview").addEventListener("click", () => {
  const { puzzle, errors } = validate();
  if (errors.length) { toast("Fix validation errors before previewing."); return; }
  saveDraft(puzzle);
  rememberRevision();
  if (!writePreview(puzzle)) { toast("Preview needs browser session storage. Check your browser settings."); return; }
  dirty = false; location.assign("./index.html?preview=1");
});
$("#start-sample").addEventListener("click", () => {
  const date = $("#puzzle-date").value || dateKey();
  renderFields({ ...structuredClone(sample), date }); dirty = true; setDocumentState("Sample loaded · Not published");
  toast("Sample loaded into the editor. Nothing has been published.");
});
$("#add-entry").addEventListener("click", () => {
  const entries = collect().crossSport.entries;
  if (entries.length >= 40) { toast("A crossword can have up to 40 entries."); return; }
  entries.push({ row: 0, col: 0, direction: "across", answer: "", clue: "" });
  renderEntries(entries); dirty = true; setDocumentState(); paintGrid();
});
document.addEventListener("click", event => {
  const remove = event.target.closest("[data-remove]");
  if (remove) {
    const entries = collect().crossSport.entries.filter((_, i) => i !== +remove.dataset.remove);
    renderEntries(entries); dirty = true; setDocumentState(); paintGrid();
  }
  const load = event.target.closest("[data-load]");
  if (load) { $("#puzzle-date").value = load.dataset.load; loadDate(); }
});
$("#export").addEventListener("click", () => {
  const { puzzle } = validate();
  const blob = new Blob([JSON.stringify(puzzle, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `daily-sports-${puzzle.date || "draft"}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("#import-file").addEventListener("change", async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 60000) throw new Error("The puzzle file must be smaller than 60 KB.");
    const data = JSON.parse(await file.text());
    const errors = validatePuzzle(data);
    if (errors.length) { $("#validation-result").innerHTML = `<ul class="validation-errors">${errors.map(error => `<li>${escape(error)}</li>`).join("")}</ul>`; throw new Error("Import didn't pass validation. The current editor hasn't changed."); }
    renderFields(data); dirty = true; pendingImport = data;
    revisionDate = null; revision = 0; live = false; setDocumentState("Imported · Not published"); saveDraft(data);
    toast("Imported all three games. Load this date before saving to Firebase; your imported draft is saved locally.");
  } catch (error) { toast(error instanceof SyntaxError ? "This file isn't valid JSON. Export the sample to see the expected format." : error.message); }
  finally { event.target.value = ""; }
});

window.addEventListener("beforeunload", event => {
  if (dirty && !saveDraft(collect())) { event.preventDefault(); event.returnValue = ""; }
});

try {
  const response = await fetch(new URL("../data/practice.json", import.meta.url));
  if (!response.ok) throw new Error();
  sample = await response.json();
  if (validatePuzzle(sample).length) throw new Error();
    const lastDate = readLocal("owner-last-date");
    const chosenDate = validDate(lastDate) ? lastDate : dateKey();
    const local = getDraft(chosenDate);
    const metadata = readLocal(`owner-revision:${chosenDate}`);
    if (metadata && metadata.date === chosenDate && Number.isInteger(metadata.revision) && metadata.revision >= 0) {
      revisionDate = metadata.date; revision = metadata.revision; live = Boolean(metadata.live);
    }
    renderFields(local && !validatePuzzle(local).length ? local : { ...structuredClone(sample), date: chosenDate });
} catch {
  message("The sample file couldn't be loaded. Refresh this page or check data/practice.json in the repository.", true);
  $("#editor").classList.add("busy"); $(".admin-sidebar").classList.add("busy");
}

if (!configured) {
  message("Local editor mode · Add your Firebase web app config to enable owner sign-in and publishing.");
  $("#owner-sign-in").hidden = true;
} else {
  try {
    connection = await connectOwner();
    connection.authModule.onAuthStateChanged(connection.auth, checkUser);
  } catch { message("Firebase couldn't connect. You can still edit and export locally. Check firebase-config.js and your network.", true); }
}
