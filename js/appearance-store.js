import { connect } from "./firebase.js";
import { appearanceSettings, classicAppearance } from "./appearance-model.js";

export async function loadAppearance(connection) {
  const { db, store } = connection || (await connect());
  const snapshot = await store.getDocFromServer(store.doc(db, "siteSettings", "appearance"));
  if (!snapshot.exists()) return classicAppearance();
  const settings = appearanceSettings(snapshot.data());
  if (!settings) throw new Error("The saved site look needs an owner correction.");
  return settings;
}

export async function saveAppearance(connection, value) {
  const { db, store, auth } = connection;
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Sign in as an owner to save the site look.");
  const settings = appearanceSettings(value);
  if (!settings) throw new Error("Choose a theme and a valid date range.");
  await store.setDoc(store.doc(db, "siteSettings", "appearance"), {
    ...settings,
    updatedAt: store.serverTimestamp(),
  });
  if (auth.currentUser?.uid !== uid) throw new Error("Your owner session changed. Sign in again.");
  return settings;
}
