import { GAMES, GAME_FIELDS, GAME_NAMES, dateKey, validDate, validateGame, validatePuzzle } from "./core.js";

export const SUBMISSION_STATUSES = ["pending", "approved", "rejected", "published"];
export function validCreatorName(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,23}$/.test(value) && value === value.trim();
}
export function creatorName(value, required = false) {
  const name = String(value ?? "").trim();
  if ((!name && required) || (name && !validCreatorName(name))) throw new Error("Use a creator name of 2–24 letters, numbers, spaces, dots, underscores, or hyphens, starting with a letter or number.");
  return name;
}
export function validateCredits(credits = {}) {
  if (!credits || typeof credits !== "object" || Array.isArray(credits) || Object.keys(credits).some(key => !GAMES.includes(key))) return ["Invalid creator credits."];
  const errors = [];
  for (const credit of Object.values(credits)) {
    if (!credit || !validCreatorName(credit.displayName) || Object.keys(credit).some(key => !["displayName", "submissionId"].includes(key)) ||
      (credit.submissionId !== undefined && (typeof credit.submissionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(credit.submissionId)))) errors.push("Invalid creator credit or submission ID.");
  }
  return errors;
}
export function blankGame(game) {
  if (game === "player") return { answer: "", sport: "", aliases: [], hints: Array(5).fill("") };
  if (game === "ladder") return { questions: Array.from({ length: 5 }, () => ({ question: "", answer: "", sport: "", aliases: [], source: "" })) };
  if (game === "cross") return { size: 5, entries: [] };
  throw new Error("Choose a game.");
}
export function blankSlate(date = dateKey()) {
  return { schemaVersion: 1, date, title: "Daily slate", ...Object.fromEntries(GAMES.map(game => [GAME_FIELDS[game], blankGame(game)])), credits: {} };
}
export function editorSlate(source, date = dateKey()) {
  const result = { ...blankSlate(date), ...structuredClone(source || {}), date };
  for (const game of GAMES) result[GAME_FIELDS[game]] = { ...blankGame(game), ...result[GAME_FIELDS[game]] };
  result.credits ||= {};
  return result;
}
export function gameEnvelope(game, data, publicName = "", submissionId) {
  const result = { schemaVersion: 1, game, creatorCredit: creatorName(publicName), data: structuredClone(data), ...(submissionId ? { submissionId } : {}) };
  const errors = validateGameImport(result);
  if (errors.length) throw new Error(errors.join("\n"));
  return result;
}
export function validateGameImport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["Import a single-game JSON object."];
  if (value.playerGuess || value.statLadder || value.crossSport) return ["This is a full-slate backup. Export one selected game from the owner desk; each import must identify exactly one game."];
  const errors = [];
  if (value.schemaVersion !== 1) errors.push("Game JSON schemaVersion must be 1.");
  if (Object.keys(value).some(key => !["schemaVersion", "game", "creatorCredit", "submissionId", "data"].includes(key))) errors.push("Game JSON contains an unexpected field. Select its release date in the owner desk.");
  errors.push(...validateGame(value.game, value.data));
  try { creatorName(value.creatorCredit); } catch (error) { errors.push(error.message); }
  if (value.creatorCredit !== undefined && typeof value.creatorCredit !== "string") errors.push("Creator credit must be text.");
  if (value.submissionId !== undefined && (typeof value.submissionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.submissionId))) errors.push("Invalid submission ID.");
  if (JSON.stringify(value).length > 60000) errors.push("The game JSON must be smaller than 60 KB.");
  return errors;
}
export function parseGameImport(text) {
  if (typeof text !== "string" || text.length > 60000) throw new Error("Import one game JSON file smaller than 60 KB.");
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error("This isn't valid JSON. Copy a game export from the review page or owner desk."); }
  const errors = validateGameImport(value);
  if (errors.length) throw new Error(errors.join("\n"));
  return gameEnvelope(value.game, value.data, value.creatorCredit, value.submissionId);
}
export function mergeGameIntoSlate(existing, envelope, date) {
  if (!validDate(date)) throw new Error("Choose a valid release date.");
  const errors = validateGameImport(envelope);
  if (errors.length) throw new Error(errors.join("\n"));
  const result = structuredClone(existing || { schemaVersion: 1, date, title: "Daily slate" });
  if (result.date !== date) throw new Error("The selected date changed. Load that date before importing.");
  result[GAME_FIELDS[envelope.game]] = structuredClone(envelope.data);
  result.credits = { ...(result.credits || {}) };
  if (envelope.creatorCredit) result.credits[envelope.game] = { displayName: envelope.creatorCredit, ...(envelope.submissionId ? { submissionId: envelope.submissionId } : {}) };
  else delete result.credits[envelope.game];
  return result;
}
export function exportGameFromSlate(slate, game) {
  const credit = slate.credits?.[game];
  return gameEnvelope(game, slate[GAME_FIELDS[game]], credit?.displayName, credit?.submissionId);
}
export function gameImportMessage(game, date) {
  return `A ${GAME_NAMES[game]} puzzle already exists for ${date}. Do you want to replace it? Only ${GAME_NAMES[game]} will change.`;
}
export function samePuzzleData(a, b) {
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}
export async function previewSlate(game, data, publicName = "") {
  const response = await fetch(new URL("../data/practice.json", import.meta.url));
  if (!response.ok) throw new Error("The preview couldn't load. Please try again.");
  const sample = await response.json();
  const result = mergeGameIntoSlate({ ...sample, date: dateKey() }, gameEnvelope(game, data, publicName), dateKey());
  result.title = `${GAME_NAMES[game]} preview`;
  const errors = validatePuzzle(result);
  if (errors.length) throw new Error(errors.join("\n"));
  return result;
}
