import { dateKey, GAME_NAMES, gameScoreLabel, gamesForLeague, leagueOf, LEAGUES } from "./core.js";
import { setPlayerScope, importRecordedResults, allResults, readLocal, writeLocal } from "./storage.js";
import { configured, connectPlayer, ensurePlayerProfile, playerResultsForDate,
  signInPlayerWithEmail, signInPlayerWithGoogle, signOutPlayer } from "./firebase.js";

const $ = selector => document.querySelector(selector);
let selectedLeague = new URLSearchParams(location.search).get("league") || "general";
if (!LEAGUES.includes(selectedLeague)) selectedLeague = "general";
$("#account-league").value = selectedLeague;
function updateEditionLinks() { for (const link of document.querySelectorAll('a[href^="./index.html"]')) link.href = `./index.html${selectedLeague === "general" ? "" : `?league=${selectedLeague}`}`; }
updateEditionLinks();
let connection, creating = false, working = false, refreshVersion = 0;
let accountRevision = readLocal("account-revision");
const identity = user => user ? `${user.uid}:${user.isAnonymous}` : "signed-out";

// Keep an already-open account page in step with sign-in/out elsewhere, even
// when a browser delays Firebase's cross-tab auth event while backgrounded.
setInterval(() => {
  if (!working && readLocal("account-revision") !== accountRevision) location.reload();
}, 1000);

function message(text, warning = false) {
  $("#account-status").textContent = text;
  $("#account-status").className = `notice${warning ? " warning" : ""}`;
}

function controls() {
  for (const id of ["player-google", "email-submit", "password-reset", "player-sign-out", "refresh-account"]) {
    $(`#${id}`).disabled = working || !connection;
  }
}

function setMode(create) {
  creating = create;
  $("#mode-sign-in").setAttribute("aria-selected", String(!create));
  $("#mode-create").setAttribute("aria-selected", String(create));
  $("#mode-sign-in").tabIndex = create ? -1 : 0;
  $("#mode-create").tabIndex = create ? 0 : -1;
  $("#email-panel").setAttribute("aria-labelledby", create ? "mode-create" : "mode-sign-in");
  $("#player-password").autocomplete = create ? "new-password" : "current-password";
  $("#player-password").minLength = create ? 6 : 1;
  $("#password-help").hidden = !create; $("#password-reset").hidden = create;
  $("#email-submit").textContent = create ? "Create account" : "Sign in";
}

function showResults(records) {
  $("#account-date").textContent = dateKey();
  $("#account-results").innerHTML = gamesForLeague(selectedLeague).map(game => {
    const result = records.find(r => r.date === dateKey() && r.game === game && r.done && leagueOf(r) === selectedLeague);
    const score = result ? gameScoreLabel(game, result) : "Not played";
    const assistance = result && game === "cross" ? `<small>${result.checks} checks · ${result.reveals} reveals</small>` : "";
    return `<div class="saved-score"><div><strong>${GAME_NAMES[game]}</strong>${assistance}</div><span>${score}</span></div>`;
  }).join("");
}

async function refreshAccount() {
  if (!connection) return;
  const version = ++refreshVersion;
  const user = connection.auth.currentUser;
  if (!user) {
    setPlayerScope("local-guest");
    $("#guest-options").hidden = false; $("#signed-in-options").hidden = true;
    $("#player-identity").textContent = ""; $("#account-badge").textContent = "GUEST";
    showResults([]); message("You're signed out. Guest play will reconnect when you're online.");
    return;
  }
  setPlayerScope(user.uid);
  $("#guest-options").hidden = !user.isAnonymous;
  $("#signed-in-options").hidden = user.isAnonymous;
  $("#account-badge").textContent = user.isAnonymous ? "GUEST" : "PLAYER ACCOUNT";
  $("#player-identity").textContent = user.email || user.displayName || "Signed in";
  message(user.isAnonymous ? "You're playing as a guest. Sign in whenever you're ready." : "You're signed in. Your completed daily scores are saved to your account.");
  const checks = await Promise.allSettled([ensurePlayerProfile(connection), playerResultsForDate(connection, dateKey(), selectedLeague)]);
  if (version !== refreshVersion || connection.auth.currentUser?.uid !== user.uid) return;
  if (checks[1].status === "fulfilled") { importRecordedResults(checks[1].value); showResults(checks[1].value); }
  else { showResults(allResults()); message("Your session is ready, but saved scores couldn't be loaded. You can keep playing and try Refresh later.", true); }
  if (checks[0].status === "rejected") message("You're signed in. Your player profile couldn't be saved yet; try Refresh when your connection returns.", true);
  controls();
}

function authError(error) {
  const messages = {
    "auth/invalid-credential": "The email or password wasn't recognized.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/email-already-in-use": "This email already has an account. Choose Sign in; its scores stay separate from your guest record.",
    "auth/credential-already-in-use": "This account already exists. Choose Sign in to open its saved scores.",
    "auth/account-exists-with-different-credential": "Use the sign-in method you originally used for this email.",
    "auth/weak-password": "Choose a stronger password with at least 6 characters.",
    "auth/password-does-not-meet-requirements": "That password doesn't meet the account's password requirements. Try a longer password with upper and lowercase letters, numbers, and a symbol.",
    "auth/popup-closed-by-user": "Sign-in was canceled. You can keep playing as a guest.",
    "auth/popup-blocked": "Allow the Google sign-in popup for this site, then try again.",
    "auth/cancelled-popup-request": "Another sign-in is already open. Finish it or try again.",
    "auth/too-many-requests": "Too many attempts. Wait a little before trying again.",
    "auth/network-request-failed": "Sign-in couldn't reach the network. Your saved game is safe on this device.",
    "auth/user-disabled": "This account is disabled. Contact the site owner.",
    "auth/operation-not-allowed": "This sign-in option isn't available yet. You can still play as a guest.",
    "auth/unauthorized-domain": "Sign-in isn't configured for this website yet. You can still play as a guest."
  };
  return messages[error.code] || "Sign-in couldn't finish. Your guest record is safe; please try again.";
}

async function accountAction(action) {
  if (working || !connection) return;
  const previousIdentity = identity(connection.auth.currentUser);
  working = true; controls();
  try { await action(); await refreshAccount(); }
  catch (error) { message(authError(error), true); }
  finally {
    if (identity(connection.auth.currentUser) !== previousIdentity) {
      accountRevision = `${Date.now()}:${Math.random()}`;
      writeLocal("account-revision", accountRevision);
    }
    working = false; controls(); $("#player-password").value = "";
  }
}

$("#mode-sign-in").addEventListener("click", () => setMode(false));
$("#mode-create").addEventListener("click", () => setMode(true));
document.querySelector(".auth-tabs").addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault(); setMode(event.key === "End" || event.key !== "Home" && !creating);
  $(creating ? "#mode-create" : "#mode-sign-in").focus();
});
$("#player-email-form").addEventListener("submit", event => {
  event.preventDefault();
  const email = $("#player-email").value, password = $("#player-password").value;
  accountAction(() => signInPlayerWithEmail(connection, email, password, creating));
});
$("#player-google").addEventListener("click", () => accountAction(() => signInPlayerWithGoogle(connection)));
$("#player-sign-out").addEventListener("click", () => accountAction(() => signOutPlayer(connection)));
$("#account-league").addEventListener("change", async event => {
  selectedLeague = event.target.value;
  const url = new URL(location.href); if (selectedLeague === "general") url.searchParams.delete("league"); else url.searchParams.set("league", selectedLeague); history.replaceState(null,"",url);
  updateEditionLinks();
  await refreshAccount();
});
$("#refresh-account").addEventListener("click", refreshAccount);
$("#password-reset").addEventListener("click", async () => {
  const email = $("#player-email");
  if (!email.value || !email.reportValidity()) { email.focus(); return; }
  if (working || !connection) return;
  working = true; controls();
  try {
    await connection.authModule.sendPasswordResetEmail(connection.auth, email.value.trim());
    message("Check your inbox if an account exists for that email. You can keep playing while you wait.");
  } catch (error) { message(authError(error), true); }
  finally { working = false; controls(); }
});

if (!configured) {
  message("Accounts aren't connected in this local demo. You can still play all the practice games.", true);
  $("#account-results").textContent = "No online scores in local demo mode.";
} else {
  try {
    connection = await connectPlayer(); controls();
    connection.authModule.onAuthStateChanged(connection.auth, refreshAccount);
  } catch {
    message("Account access couldn't connect. You can still play practice games and try signing in later.", true);
    $("#account-results").textContent = "Saved scores are temporarily unavailable.";
  }
}
