import { configured, connectOwner, isOwner } from "./firebase.js";
import { createOwnerDesk } from "./owner-desk.js";
import { createOwnerAccess } from "./owner-access.js";
import { withTimeout } from "./async.js";

const $ = (selector) => document.querySelector(selector);
let connection, connecting, desk;
function message(text, warning = false) {
  $("#owner-status").textContent = text;
  $("#owner-status").className = `notice${warning ? " warning" : ""}`;
}
const access = createOwnerAccess({
  verify: (uid) => withTimeout(isOwner(connection, uid), 10000),
  lock(user) {
    desk?.destroy();
    desk = null;
    $("#owner-workspace").hidden = true;
    $("#owner-workspace").replaceChildren();
    $("#owner-sign-in").hidden = Boolean(user);
    $("#sign-out").hidden = !user;
    $("#owner-identity").hidden = !user;
    $("#owner-identity").textContent = user ? `Signed in as ${user.email || "an account"}` : "";
    $("#owner-badge").textContent = user ? "VERIFYING ACCESS" : "OWNER ACCESS";
    $("#connection-description").textContent =
      "The daily slate builder is available only to verified owners.";
    message(
      user
        ? "Checking owner access…"
        : "Sign in with an authorized owner account to open the desk.",
    );
  },
  async unlock(user, current) {
    const root = document.createElement("div");
    root.append($("#owner-desk-template").content.cloneNode(true));
    $("#owner-workspace").append(root);
    const editor = createOwnerDesk(root, connection);
    desk = editor;
    try {
      await withTimeout(
        editor.ready,
        12000,
        "The editor couldn't load. Check your connection and sign in again.",
      );
    } catch (error) {
      editor.destroy();
      if (desk === editor) desk = null;
      throw error;
    }
    if (!current()) {
      editor.destroy();
      return;
    }
    $("#owner-workspace").hidden = false;
    $("#owner-badge").textContent = "OWNER VERIFIED";
    $("#connection-description").textContent =
      "Your account has access to the daily slate builder.";
    message("Owner access verified. Your daily slate builder is ready.");
    return () => editor.destroy();
  },
  deny(error) {
    $("#owner-badge").textContent = "ACCESS REQUIRED";
    message(
      error
        ? error.message ||
            "Owner access couldn't be verified. Check your connection and sign in again."
        : "This account doesn't have owner access. Sign out to use an authorized account.",
      true,
    );
  },
});

async function initialize() {
  if (connection) return connection;
  if (!connecting)
    connecting = (async () => {
      const result = await withTimeout(connectOwner(), 10000);
      connection = result;
      connection.authModule.onAuthStateChanged(connection.auth, (user) => access.check(user));
      return connection;
    })().finally(() => {
      connecting = null;
    });
  return connecting;
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    const session = await initialize();
    await session.authModule.signInWithEmailAndPassword(
      session.auth,
      $("#owner-email").value.trim(),
      $("#owner-password").value,
    );
  } catch (error) {
    message(
      error.code === "auth/invalid-credential"
        ? "Email or password wasn't recognized."
        : "Sign-in couldn't finish. Check your connection and try again.",
      true,
    );
  } finally {
    $("#owner-password").value = "";
    button.disabled = false;
  }
});
$("#google-sign-in").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const session = await initialize();
    const provider = new session.authModule.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await session.authModule.signInWithPopup(session.auth, provider);
  } catch (error) {
    message(
      error.code === "auth/popup-closed-by-user"
        ? "Sign-in was canceled. Sign in to open the owner desk."
        : "Google sign-in couldn't finish. Check your connection and try again.",
      true,
    );
  } finally {
    button.disabled = false;
  }
});
$("#sign-out").addEventListener("click", async () => {
  // Close the desk immediately; a slow sign-out must not leave draft fields visible.
  await access.check(null);
  try {
    await connection.authModule.signOut(connection.auth);
  } catch {
    message("The desk is locked. Sign-out couldn't finish; refresh and try again.", true);
  }
});
if (!configured) {
  $("#owner-sign-in").hidden = true;
  message("Owner sign-in is unavailable. The desk remains locked.", true);
} else {
  initialize().catch(() =>
    message(
      "Owner sign-in couldn't connect. The desk is locked; check your connection and try again.",
      true,
    ),
  );
}
