// Runs before styles so a saved dark preference never flashes a light page.
(() => {
  const root = document.documentElement;
  let mode, settings, previewing;
  try {
    mode = localStorage.getItem("dsg:appearance:mode");
    const preview = JSON.parse(sessionStorage.getItem("dsg:appearance:preview"));
    const cache = JSON.parse(localStorage.getItem("dsg:appearance:cache"));
    settings = preview || cache?.settings;
    previewing = Boolean(preview);
  } catch {
    // Storage can be unavailable in private browsing; the system preference still works.
  }
  root.dataset.colorMode =
    mode === "dark" || (mode !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const seasons = ["classic", "halloween", "thanksgiving", "christmas"];
  root.dataset.season =
    seasons.includes(settings?.season) &&
    (previewing ||
      ((!settings.startsOn || today >= settings.startsOn) &&
        (!settings.endsOn || today <= settings.endsOn)))
      ? settings.season
      : "classic";
})();
