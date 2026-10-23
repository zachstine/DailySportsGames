import {
  SEASONS,
  APPEARANCE_KEYS,
  CACHE_AGE,
  appearanceSettings,
  classicAppearance,
  cachedAppearance,
  activeSeason,
  colorMode,
} from "./appearance-model.js";
import { loadAppearance } from "./appearance-store.js";
import { withTimeout } from "./async.js";
import { createHalloweenDecorations } from "./halloween.js";

function browserStorage(name) {
  try {
    return window[name];
  } catch {
    return null;
  }
}

const local = browserStorage("localStorage");
const session = browserStorage("sessionStorage");
const root = document.documentElement;
const system = matchMedia("(prefers-color-scheme: dark)");
let saved = classicAppearance();
let preview = read(session, APPEARANCE_KEYS.preview);
preview = appearanceSettings(preview);

function read(storage, key) {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    // Appearance remains usable for this page when browser storage is blocked.
  }
}

function modePreference() {
  try {
    return local?.getItem(APPEARANCE_KEYS.mode);
  } catch {
    return null;
  }
}

function renderMode(mode = colorMode(modePreference(), system.matches)) {
  root.dataset.colorMode = mode;
  for (const button of document.querySelectorAll("[data-theme-toggle]")) {
    const dark = mode === "dark";
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} mode`);
    button.title = `Switch to ${dark ? "light" : "dark"} mode`;
    button.querySelector("[data-theme-label]").textContent = dark ? "Light mode" : "Dark mode";
    button.querySelector("[data-theme-symbol]").textContent = dark ? "☀" : "☾";
  }
}

function renderSeason() {
  // Explicit previews ignore the date window so owners can inspect a future holiday.
  const season = preview ? preview.season : activeSeason(saved);
  root.dataset.season = season;
  const details = SEASONS[season];
  halloween.setActive(season === "halloween");
  for (const badge of document.querySelectorAll("[data-season-badge]")) {
    badge.hidden = season === "classic";
    badge.querySelector("[data-season-symbol]").textContent = details.symbol;
    badge.querySelector("[data-season-label]").textContent = details.label;
  }
  const banner = document.querySelector("#appearance-preview");
  banner.hidden = !preview;
  banner.querySelector("[data-preview-name]").textContent = details.name;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", getComputedStyle(root).getPropertyValue("--paper").trim());
}

export function previewAppearance(value) {
  preview = appearanceSettings(value);
  write(session, APPEARANCE_KEYS.preview, preview);
  renderSeason();
}

export function rememberAppearance(value) {
  saved = appearanceSettings(value) || classicAppearance();
  write(local, APPEARANCE_KEYS.cache, { settings: saved, fetchedAt: Date.now() });
  renderSeason();
}

const banner = document.createElement("div");
banner.id = "appearance-preview";
banner.className = "appearance-preview";
banner.hidden = true;
banner.innerHTML = /* HTML */ `<span>
    <strong data-preview-name></strong> theme preview · Only visible on this device </span
  ><button class="text-button" type="button">Exit preview ×</button>`;
document.querySelector(".site-header")?.after(banner);
banner.querySelector("button").addEventListener("click", () => previewAppearance(null));
const halloween = createHalloweenDecorations();

for (const button of document.querySelectorAll("[data-theme-toggle]")) {
  button.addEventListener("click", () => {
    const mode = root.dataset.colorMode === "dark" ? "light" : "dark";
    try {
      local?.setItem(APPEARANCE_KEYS.mode, mode);
    } catch {
      // A device preference is optional; switching the current page always works.
    }
    renderMode(mode);
    renderSeason();
  });
}
system.addEventListener("change", () => {
  if (!["dark", "light"].includes(modePreference())) {
    renderMode();
    renderSeason();
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === APPEARANCE_KEYS.mode || event.key === null) renderMode();
  if (event.key === APPEARANCE_KEYS.cache) {
    saved = appearanceSettings(read(local, APPEARANCE_KEYS.cache)?.settings) || saved;
  }
  renderSeason();
});

const cache = read(local, APPEARANCE_KEYS.cache);
saved = appearanceSettings(cache?.settings) || classicAppearance();
renderMode();
renderSeason();
let refreshing = false;
async function refreshAppearance() {
  if (refreshing || cachedAppearance(read(local, APPEARANCE_KEYS.cache))) return;
  refreshing = true;
  try {
    // A failed theme lookup never delays authentication or puzzle loading.
    rememberAppearance(await withTimeout(loadAppearance(), 3000));
  } catch {
    // Keep the most recent look when offline; try again on the next visit.
  } finally {
    refreshing = false;
  }
}
refreshAppearance();
setInterval(refreshAppearance, CACHE_AGE);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    renderSeason();
    refreshAppearance();
  }
});
// A scheduled look ends even when the page stays open across Eastern midnight.
setInterval(renderSeason, 60000);
