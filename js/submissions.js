import { GAME_NAMES } from "./core.js";
import { blankGame, creatorName, previewSlate, SUBMISSION_STATUSES } from "./puzzles.js";
import { GameEditor, escape, showErrors, downloadGame } from "./game-editor.js";
import { readLocal, writeLocal, writePreview, resetPractice } from "./storage.js";
import { configured, connectOwner, isOwner } from "./firebase.js";
import { listSubmissions, loadSubmission, submissionEnvelope, saveSubmissionReview, rejectSubmission } from "./community.js";

const $ = selector => document.querySelector(selector);
const editor = new GameEditor($("#review-editor"), "review");
let connection, authorized = false, items = [], cursor = null, more = false, current = null, dirty = false, working = false, authVersion = 0;
const dates = value => value?.toDate ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(value.toDate()) : "Just now";
const draftKey = id => `review-draft:${connection.auth.currentUser.uid}:${id}`;
const openKey = () => `review-open-id:${connection.auth.currentUser.uid}`;

function message(text, warning = false) { $("#review-status").textContent = text; $("#review-status").className = `notice${warning ? " warning" : ""}`; }
function controls() {
  for (const id of ["review-refresh", "review-more", "review-preview", "review-save", "review-approve", "review-reject", "review-copy", "review-download"]) {
    $("#" + id).disabled = working || !authorized;
  }
  for (const id of ["review-preview", "review-save", "review-approve", "review-reject", "review-copy", "review-download"]) if (!current) $("#" + id).disabled = true;
  if (current?.status === "published") { $("#review-approve").disabled = true; $("#review-reject").disabled = true; }
  if (dirty || !["approved", "published"].includes(current?.status)) { $("#review-copy").disabled = true; $("#review-download").disabled = true; }
  $("#review-more").hidden = !more;
}
function paintList() {
  const game = $("#filter-game").value, status = $("#filter-status").value;
  const visible = items.filter(item => (!game || item.game === game) && (!status || item.status === status));
  $("#queue-count").textContent = `${visible.length} matching suggestion${visible.length === 1 ? "" : "s"} · ${items.length} loaded`;
  $("#queue-body").innerHTML = visible.length ? visible.map(item=>`<tr><td><button class="text-button" data-review="${escape(item.id)}">Review →</button><small>${escape(item.id)}</small></td><td>${escape(GAME_NAMES[item.game] || "Unknown game")}</td><td>${escape(item.reviewedName ?? item.proposedName)}</td><td>${escape(dates(item.createdAt))}<small>Eastern time</small></td><td><span class="status-tag ${SUBMISSION_STATUSES.includes(item.status) ? item.status : ""}">${escape(item.status)}</span></td></tr>`).join("") : '<tr><td colspan="5">No matching suggestions. Try another filter or load older submissions.</td></tr>';
  controls();
}
async function refresh(append = false) {
  if (!authorized || working) return;
  working = true; controls(); const version = authVersion;
  try {
    const page = await listSubmissions(connection, append ? cursor : null);
    if (!authorized || version !== authVersion) return;
    items = append ? [...items, ...page.items.filter(item=>!items.some(old=>old.id === item.id))] : page.items;
    cursor = page.cursor; more = page.more; paintList();
    message("Private review queue. Suggestions become public only through the owner desk's publishing controls.");
  } catch (error) { message(error.code === "permission-denied" ? "Only an authorized owner can read the review queue." : "The queue couldn't load. Check your connection and try Refresh.", true); }
  finally { working = false; controls(); }
}
function saveWorkingDraft() {
  if (!current) return;
  dirty = true; $("#review-json").value = "";
  writeLocal(draftKey(current.id), { revision: current.revision, data: editor.read(), name: $("#approved-name").value });
  $("#review-feedback").hidden = false; $("#review-feedback").className = "notice";
  $("#review-feedback").textContent = "Unsaved review edits. Save or approve before copying the finalized JSON."; controls();
}
async function openSubmission(id, restoreDraft = true) {
  if (!authorized || working) return;
  working = true; controls(); const version = authVersion;
  try {
    const item = await loadSubmission(connection, id);
    if (!authorized || version !== authVersion) return;
    current = item; dirty = false; writeLocal(openKey(), id);
    $("#review-detail").hidden = false;
    $("#review-title").textContent = `Review ${GAME_NAMES[item.game] || "submission"}`;
    $("#review-meta").textContent = `${item.id} · ${item.status} · Submitted ${dates(item.createdAt)} Eastern`;
    $("#original-name").textContent = item.proposedName;
    $("#approved-name").value = item.reviewedName ?? item.proposedName;
    $("#published-note").hidden = item.status !== "published";
    $("#published-note").textContent = item.status === "published" ? `Published or scheduled for ${(item.publishedDates || []).join(", ")}. Saving the public name also corrects its linked credits. Puzzle edits affect the exported JSON; live answers and clues stay locked.` : "";
    $("#review-feedback").hidden = true; $("#review-json").value = "";
    try { editor.set(item.game, submissionEnvelope(item).data); }
    catch (error) { editor.set(item.game, blankGame(item.game)); showErrors($("#review-feedback"), [error.message, "Correct the fields below before approving, or reject this suggestion."]); }
    const draft = restoreDraft ? readLocal(draftKey(id)) : null;
    if (draft && draft.revision === item.revision) {
      try { editor.set(item.game, draft.data); $("#approved-name").value = draft.name; dirty = true; }
      catch { /* A damaged local draft never replaces the server submission. */ }
    }
    if (!dirty && ["approved", "published"].includes(item.status)) $("#review-json").value = JSON.stringify(submissionEnvelope(item, true), null, 2);
    $("#review-title").focus();
  } catch (error) { message(error.message || "This suggestion couldn't be opened.", true); }
  finally { working = false; controls(); }
}
function checkedData() {
  const errors = editor.errors();
  let name = ""; try { name = creatorName($("#approved-name").value, true); } catch (error) { errors.unshift(error.message); }
  if (errors.length) { showErrors($("#review-feedback"), errors); return null; }
  return { data: editor.read(), name };
}
async function saveReview(approve) {
  if (!current || working) return;
  const values = checkedData(); if (!values) return;
  working = true; controls();
  try {
    await saveSubmissionReview(connection, current, values.data, values.name, approve ? "approved" : current.status);
    writeLocal(draftKey(current.id), null); dirty = false;
    const id = current.id; working = false; await openSubmission(id, false); await refresh();
    showErrors($("#review-feedback"), []); $("#review-feedback").textContent = approve ? "Approved. Copy or download this game's JSON, then import it for a date in the owner desk." : "Review edits saved. Public name corrections have been applied to linked credits.";
  } catch (error) { showErrors($("#review-feedback"), [error.message || "The review couldn't be saved."]); }
  finally { working = false; controls(); }
}
$("#review-editor").addEventListener("game-edit", saveWorkingDraft);
$("#approved-name").addEventListener("input", saveWorkingDraft);
$("#filter-game").addEventListener("change", paintList); $("#filter-status").addEventListener("change", paintList);
$("#review-refresh").addEventListener("click", ()=>refresh()); $("#review-more").addEventListener("click", ()=>refresh(true));
$("#queue-body").addEventListener("click", event=>{ const button = event.target.closest("[data-review]"); if(button) openSubmission(button.dataset.review); });
$("#review-save").addEventListener("click", ()=>saveReview(false)); $("#review-approve").addEventListener("click", ()=>saveReview(true));
$("#review-reject").addEventListener("click", async ()=>{
  if (!current || working) return; working = true; controls();
  try { await rejectSubmission(connection, current); const id=current.id; writeLocal(draftKey(id), null); working=false; await openSubmission(id,false); await refresh(); }
  catch(error){showErrors($("#review-feedback"),[error.message]);}
  finally{working=false;controls();}
});
$("#review-preview").addEventListener("click", async ()=>{
  if (!current || working) return; const values=checkedData(); if(!values)return;
  working=true;controls();
  try {
    writeLocal(draftKey(current.id),{revision:current.revision,...values});
    const puzzle=await previewSlate(current.game,values.data,values.name);
    resetPractice(puzzle,"preview");
    if(!writePreview(puzzle,{href:"./admin/submissions/",game:current.game}))throw new Error("Preview needs browser session storage.");
    location.assign(`../../index.html?preview=1#${current.game}`);
  }catch(error){showErrors($("#review-feedback"),[error.message]);}
  finally{working=false;controls();}
});
$("#review-copy").addEventListener("click",async()=>{
  if(!current||dirty)return;
  try { const value=JSON.stringify(submissionEnvelope(current,true),null,2); $("#review-json").value=value; await navigator.clipboard.writeText(value); message("Approved game JSON copied. Select its date and import it in the owner desk."); }
  catch(error){$("#review-json").focus();$("#review-json").select();message(error.message||"Select the JSON below and copy it manually.",true);}
});
$("#review-download").addEventListener("click",()=>{if(current&&!dirty)try{downloadGame(submissionEnvelope(current,true));}catch(error){message(error.message,true);}});
$("#review-sign-out").addEventListener("click",()=>connection?.authModule.signOut(connection.auth));

async function checkUser(user) {
  const version=++authVersion; authorized=false; items=[];current=null;dirty=false;cursor=null;more=false;
  $("#review-protected").hidden=true;$("#review-detail").hidden=true;$("#queue-body").textContent="";$("#review-editor").textContent="";$("#review-json").value="";$("#approved-name").value="";
  $("#review-sign-out").hidden=!user;$("#review-sign-in").hidden=Boolean(user);controls();
  if(!user){message("Sign in through the owner desk to review community puzzles. Player sign-in does not grant publishing access.");return;}
  try {
    const allowed=await isOwner(connection,user.uid);if(version!==authVersion)return;
    if(!allowed){message("This account isn't on the owner list. The review queue is private.",true);return;}
    authorized=true;$("#review-protected").hidden=false;controls();await refresh();
    const id=readLocal(openKey());if(id)await openSubmission(id);
  }catch{message("Owner access couldn't be verified. Please try again from the owner desk.",true);}
}
if(!configured)message("Review is unavailable in the local demo. Connect Firebase and sign in through the owner desk.");
else try{connection=await connectOwner();connection.authModule.onAuthStateChanged(connection.auth,checkUser);}catch{message("The review queue couldn't connect. Try again when you're online.",true);}
