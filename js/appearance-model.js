import { dateKey, validDate } from "./core.js";

export const SEASONS = {
  classic: { name: "Classic", symbol: "✦", label: "A fresh slate. Every day." },
  halloween: { name: "Halloween", symbol: "🎃", label: "No tricks. Just trivia." },
  thanksgiving: { name: "Thanksgiving", symbol: "🍂", label: "A full plate of sports." },
  christmas: { name: "Christmas", symbol: "❄", label: "A little holiday competition." },
};
export const APPEARANCE_KEYS = {
  mode: "dsg:appearance:mode",
  cache: "dsg:appearance:cache",
  preview: "dsg:appearance:preview",
};
export const CACHE_AGE = 15 * 60 * 1000;
export const classicAppearance = () => ({ season: "classic", startsOn: "", endsOn: "" });

export function appearanceSettings(value) {
  if (!value || typeof value !== "object" || !Object.hasOwn(SEASONS, value.season)) return null;
  const { season, startsOn, endsOn } = value;
  if (typeof startsOn !== "string" || typeof endsOn !== "string") return null;
  if ((startsOn && !validDate(startsOn)) || (endsOn && !validDate(endsOn))) return null;
  if (startsOn && endsOn && endsOn < startsOn) return null;
  return { season, startsOn, endsOn };
}

export function activeSeason(settings, today = dateKey()) {
  const value = appearanceSettings(settings);
  if (
    !value ||
    (value.startsOn && today < value.startsOn) ||
    (value.endsOn && today > value.endsOn)
  )
    return "classic";
  return value.season;
}

export function cachedAppearance(value, now = Date.now()) {
  if (!value || !Number.isFinite(value.fetchedAt)) return null;
  const age = now - value.fetchedAt;
  return age >= 0 && age < CACHE_AGE ? appearanceSettings(value.settings) : null;
}

export function colorMode(preference, systemDark) {
  return preference === "dark" || (preference !== "light" && systemDark) ? "dark" : "light";
}
