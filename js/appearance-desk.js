import { SEASONS, appearanceSettings, activeSeason } from "./appearance-model.js";
import { loadAppearance, saveAppearance } from "./appearance-store.js";
import { previewAppearance, rememberAppearance } from "./appearance.js";
import { withTimeout } from "./async.js";

export function createAppearanceDesk(root, connection, services = {}) {
  const load = services.load || loadAppearance;
  const save = services.save || saveAppearance;
  const controller = new AbortController();
  const $ = (selector) => root.querySelector(selector);
  const status = $("#appearance-status");
  let active = true,
    ready = false,
    saving = false,
    previewing = false,
    touched = false;

  root.addEventListener(
    "change",
    (event) => {
      if (event.target.closest(".appearance-fields")) touched = true;
    },
    { signal: controller.signal },
  );

  function collect() {
    return appearanceSettings({
      season: $("#site-season").value,
      startsOn: $("#season-start").value,
      endsOn: $("#season-end").value,
    });
  }

  function setFields(value) {
    $("#site-season").value = value.season;
    $("#season-start").value = value.startsOn;
    $("#season-end").value = value.endsOn;
  }

  $("#preview-appearance").addEventListener(
    "click",
    () => {
      if (!active) return;
      const settings = collect();
      if (!settings) {
        status.textContent = "Choose a valid date range. The end date must follow the start date.";
        return;
      }
      previewAppearance(settings);
      previewing = true;
      status.textContent = [
        `${SEASONS[settings.season].name} preview is on.`,
        "Use the header toggle to check light and dark mode.",
        "Your visitors still see the saved look.",
      ].join(" ");
    },
    { signal: controller.signal },
  );

  $("#save-appearance").addEventListener(
    "click",
    async () => {
      if (!active || !ready || saving) return;
      const settings = collect();
      if (!settings) {
        status.textContent = "Choose a valid date range. The end date must follow the start date.";
        return;
      }
      saving = true;
      $("#save-appearance").disabled = true;
      status.textContent = "Saving site look…";
      try {
        const saved = await withTimeout(save(connection, settings), 10000);
        if (!active) return;
        rememberAppearance(saved);
        previewAppearance(null);
        previewing = false;
        status.textContent = [
          `${SEASONS[saved.season].name} saved for all editions.`,
          activeSeason(saved) === saved.season
            ? "It is active now."
            : "It will appear during the selected dates.",
          "Visitors receive updates within 15 minutes.",
        ].join(" ");
      } catch {
        if (active)
          status.textContent =
            "The site look couldn't be saved. Check your owner connection and try again.";
      } finally {
        if (active) {
          saving = false;
          $("#save-appearance").disabled = false;
        }
      }
    },
    { signal: controller.signal },
  );

  withTimeout(load(connection), 4000)
    .then((value) => {
      if (!active) return;
      if (!touched) setFields(value);
      ready = true;
      $("#save-appearance").disabled = false;
      status.textContent = [
        `${SEASONS[value.season].name} is the saved site look.`,
        "Preview any changes before saving.",
      ].join(" ");
    })
    .catch(() => {
      if (active)
        status.textContent =
          "The saved site look couldn't load. You can still preview themes on this device.";
    });

  return {
    destroy() {
      active = false;
      controller.abort();
      if (previewing) previewAppearance(null);
    },
  };
}
