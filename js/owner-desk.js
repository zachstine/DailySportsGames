import {
  dateKey,
  validDate,
  releaseTime,
  validatePuzzle,
  validateGame,
  buildCrossword,
  GAMES,
  GAME_FIELDS,
  GAME_NAMES,
  leagueOf,
  editionKey,
  gamesForLeague,
  LEAGUE_NAMES,
} from "./core.js";
import { getDraft, saveDraft, writePreview, readLocal, writeLocal } from "./storage.js";
import { loadOwnerPuzzle, saveOwnerPuzzle, upcomingPuzzles } from "./firebase.js";
import {
  blankSlate,
  editorSlate,
  parseGameImport,
  exportGameFromSlate,
  gameImportMessage,
  validateCredits,
  samePuzzleData,
} from "./puzzles.js";
import { importOwnerGame, saveOwnerCredits } from "./community.js";
import { downloadGame, GameEditor } from "./game-editor.js";
import { collectPreviewEditions } from "./preview.js";
import { withTimeout } from "./async.js";
import { createAppearanceDesk } from "./appearance-desk.js";
import { icon } from "./icons.js";

export function createOwnerDesk(root, connection) {
  const controller = new AbortController();
  const appearance = createAppearanceDesk(root, connection);
  const $ = (selector) => root.querySelector(selector);
  const toastElement = document.querySelector("#toast");
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
    );
  let authorized = true,
    revision = 0,
    revisionDate = null,
    dirty = false,
    writing = false,
    live = false,
    localTimer,
    toastTimer;
  let currentLeague = "general",
    revisionLeague = "general";
  const extraEditors = {
    grid: new GameEditor($("#grid-editor"), "owner-grid"),
    drill: new GameEditor($("#drill-editor"), "owner-drill"),
  };
  let current,
    sample,
    parsedImport = null,
    replaceImport = false;

  function rememberRevision() {
    writeLocal("owner-last-date", $("#puzzle-date").value);
    writeLocal("owner-last-league", currentLeague);
    if (revisionDate)
      writeLocal(`owner-revision:${editionKey(revisionDate, revisionLeague)}`, {
        date: revisionDate,
        revision,
        live,
      });
  }

  function toast(value) {
    clearTimeout(toastTimer);
    toastElement.textContent = value;
    toastElement.hidden = false;
    toastTimer = setTimeout(() => {
      toastElement.hidden = true;
    }, 5000);
  }

  function splitAliases(value) {
    return value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function renderFields(puzzle) {
    const included = Object.fromEntries(
      ["grid", "drill"].map((game) => [game, Boolean(puzzle[GAME_FIELDS[game]])]),
    );
    puzzle = editorSlate(puzzle, puzzle.date);
    current = structuredClone(puzzle);
    currentLeague = leagueOf(puzzle);
    $("#owner-league").value = currentLeague;
    for (const el of root.querySelectorAll("[data-general-only]"))
      el.hidden = currentLeague !== "general";
    for (const game of ["grid", "drill"]) {
      extraEditors[game].set(game, puzzle[GAME_FIELDS[game]]);
      $("#include-" + game).checked = included[game];
    }
    for (const option of $("#export-game").options)
      option.hidden = !gamesForLeague(currentLeague).includes(option.value);
    if (!gamesForLeague(currentLeague).includes($("#export-game").value))
      $("#export-game").value = "player";
    $("#edition-help").textContent =
      `${LEAGUE_NAMES[currentLeague]} edition · Its own draft, schedule, scores, and streaks. Switch editions to prepare an optional league slate.`;
    $("#puzzle-date").value = puzzle.date;
    $("#puzzle-title").value = puzzle.title;
    writeLocal("owner-last-date", puzzle.date);
    $("#player-answer").value = puzzle.playerGuess.answer;
    $("#player-sport").value = puzzle.playerGuess.sport;
    $("#player-aliases").value = puzzle.playerGuess.aliases.join(", ");
    for (const game of GAMES)
      $(`#credit-${game}`).value = puzzle.credits?.[game]?.displayName || "";
    $("#hint-fields").innerHTML = puzzle.playerGuess.hints
      .map(
        (hint, index) =>
          /* HTML */ `<div class="field">
            <label for="hint-${index}"
              >Clue ${index + 1} ·
              ${[
                "Distinctive stat or fact",
                "Supporting detail",
                "Career context",
                "Team or era",
                "Signature clue",
              ][index]}</label
            ><textarea id="hint-${index}" maxlength="500" rows="2">${escape(hint)}</textarea>
          </div>`,
      )
      .join("");
    $("#ladder-fields").innerHTML = puzzle.statLadder.questions
      .map(
        (question, index) =>
          /* HTML */ `<div class="rung-editor" data-rung="${index}">
            <h3>Rung ${index + 1} · ${index + 1} point${index ? "s" : ""}</h3>
            <div class="field">
              <label for="question-${index}"
                >Question ·
                ${["Easy", "Getting warmer", "Challenging", "Difficult", "Expert"][index]}</label
              ><textarea id="question-${index}" maxlength="500" rows="2">
${escape(question.question)}</textarea
              >
            </div>
            <div class="field-row">
              <div class="field">
                <label for="stat-answer-${index}">Answer</label
                ><input
                  id="stat-answer-${index}"
                  maxlength="120"
                  value="${escape(question.answer)}"
                />
              </div>
              <div class="field">
                <label for="stat-sport-${index}">Sport / league</label
                ><input id="stat-sport-${index}" maxlength="30" value="${escape(question.sport)}" />
              </div>
            </div>
            <div class="field">
              <label for="stat-aliases-${index}">Accepted aliases · comma separated</label
              ><input id="stat-aliases-${index}" value="${escape(question.aliases.join(", "))}" />
            </div>
            <div class="field">
              <label for="stat-source-${index}">Source URL · https</label
              ><input
                id="stat-source-${index}"
                type="url"
                value="${escape(question.source)}"
                placeholder="https://..."
              />
            </div>
          </div>`,
      )
      .join("");
    $("#cross-size").value = String(puzzle.crossSport.size);
    renderEntries(puzzle.crossSport.entries);
    dirty = false;
    setDocumentState();
    paintGrid();
  }

  function renderEntries(entries) {
    $("#cross-fields").innerHTML = entries
      .map(
        (entry, index) =>
          /* HTML */ `<div class="cross-entry" data-entry="${index}">
            <div class="cross-entry-top">
              <h3>Entry ${index + 1}</h3>
              <button
                class="remove-entry"
                data-remove="${index}"
                aria-label="Remove crossword entry ${index + 1}"
              >
                Remove
              </button>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="cross-row-${index}">Row</label
                ><input
                  id="cross-row-${index}"
                  data-prop="row"
                  type="number"
                  min="1"
                  max="11"
                  value="${entry.row + 1}"
                />
              </div>
              <div class="field">
                <label for="cross-col-${index}">Column</label
                ><input
                  id="cross-col-${index}"
                  data-prop="col"
                  type="number"
                  min="1"
                  max="11"
                  value="${entry.col + 1}"
                />
              </div>
              <div class="field">
                <label for="cross-direction-${index}">Direction</label
                ><select id="cross-direction-${index}" data-prop="direction">
                  <option value="across" ${entry.direction === "across" ? "selected" : ""}>
                    Across
                  </option>
                  <option value="down" ${entry.direction === "down" ? "selected" : ""}>Down</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label for="cross-answer-${index}">Answer</label
              ><input
                id="cross-answer-${index}"
                data-prop="answer"
                maxlength="30"
                value="${escape(entry.answer)}"
              />
            </div>
            <div class="field">
              <label for="cross-clue-${index}">Clue</label
              ><input
                id="cross-clue-${index}"
                data-prop="clue"
                maxlength="500"
                value="${escape(entry.clue)}"
              />
            </div>
          </div>`,
      )
      .join("");
  }

  function collect() {
    const questions = Array.from({ length: 5 }, (_, i) => ({
      question: $(`#question-${i}`).value.trim(),
      answer: $(`#stat-answer-${i}`).value.trim(),
      sport: $(`#stat-sport-${i}`).value.trim(),
      aliases: splitAliases($(`#stat-aliases-${i}`).value),
      source: $(`#stat-source-${i}`).value.trim(),
    }));
    const entries = [...root.querySelectorAll("[data-entry]")].map((element) => {
      const value = (prop) => element.querySelector(`[data-prop="${prop}"]`).value;
      return {
        row: +value("row") - 1,
        col: +value("col") - 1,
        direction: value("direction"),
        answer: value("answer").trim(),
        clue: value("clue").trim(),
      };
    });
    const credits = {};
    for (const game of GAMES) {
      if (
        !gamesForLeague(currentLeague).includes(game) ||
        (["grid", "drill"].includes(game) && !$(`#include-${game}`).checked)
      )
        continue;
      const displayName = $(`#credit-${game}`).value.trim();
      if (displayName)
        credits[game] = {
          displayName,
          ...(current?.credits?.[game]?.submissionId
            ? { submissionId: current.credits[game].submissionId }
            : {}),
        };
    }
    return {
      schemaVersion: 1,
      ...(currentLeague !== "general" ? { league: currentLeague } : {}),
      ...(currentLeague === "general"
        ? Object.fromEntries(
            ["grid", "drill"]
              .filter((game) => $("#include-" + game).checked)
              .map((game) => [GAME_FIELDS[game], extraEditors[game].read()]),
          )
        : {}),
      date: $("#puzzle-date").value,
      title: $("#puzzle-title").value.trim(),
      playerGuess: {
        answer: $("#player-answer").value.trim(),
        sport: $("#player-sport").value.trim(),
        aliases: splitAliases($("#player-aliases").value),
        hints: Array.from({ length: 5 }, (_, i) => $(`#hint-${i}`).value.trim()),
      },
      statLadder: { questions },
      crossSport: { size: +$("#cross-size").value, entries },
      credits,
    };
  }

  function paintGrid() {
    const model = buildCrossword(collect().crossSport);
    $("#editor-grid").style.gridTemplateColumns = `repeat(${model.size || 5}, 1fr)`;
    $("#editor-grid").innerHTML = model.cells
      ? model.cells
          .map((cell) =>
            cell
              ? /* HTML */ `<div class="editor-square">
                  ${cell.number ? /* HTML */ `<span>${cell.number}</span>` : ""}${cell.letter}
                </div>`
              : '<div class="editor-square black"></div>',
          )
          .join("")
      : "";
    $("#cross-grid-note").textContent = model.errors.length
      ? model.errors[0]
      : `${model.entries.length} connected entries. Numbering is automatic.`;
  }

  function setDocumentState(label) {
    $("#document-state").textContent =
      label ||
      (live
        ? "Live · Locked"
        : dirty
          ? "Unsaved changes"
          : revisionDate
            ? `Firebase revision ${revision}`
            : "Local draft");
    $("#save-cloud").disabled = !authorized || writing || live;
    $("#publish").disabled = !authorized || writing || live;
    $("#import-game").disabled = writing || live;
    $("#import-game").textContent = authorized
      ? "Import game to this date"
      : "Import into local draft";
    $("#save-credit-names").disabled = !authorized || writing || !revisionDate;
    for (const input of root.querySelectorAll(
      '#editor input:not(#puzzle-date):not([id^="credit-"]), #editor textarea, #editor select, #editor [data-remove], #add-entry, #start-sample',
    ))
      input.disabled = writing || live;
    $("#puzzle-date").disabled = writing;
    $("#owner-league").disabled = writing;
    for (const game of GAMES) $(`#credit-${game}`).disabled = writing;
    const changedDate = revisionDate && $("#puzzle-date").value !== revisionDate;
    $("#date-warning").hidden = !changedDate;
    if (changedDate)
      $("#date-warning").textContent =
        "Date changed. Use Load date before saving to Firebase so you don't overwrite an existing slate.";
    const date = $("#puzzle-date").value;
    try {
      const release = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        dateStyle: "full",
        timeStyle: "short",
      }).format(releaseTime(date));
      $("#release-description").textContent =
        `Release: ${release} Eastern. Published games stay hidden until then.`;
    } catch {
      $("#release-description").textContent =
        "Choose a valid date to set the Eastern midnight release.";
    }
  }

  function validate(show = true) {
    const puzzle = collect();
    const errors = [...validatePuzzle(puzzle), ...validateCredits(puzzle.credits)];
    if (show)
      $("#validation-result").innerHTML = errors.length
        ? /* HTML */ `<ul class="validation-errors">
            ${errors.map((error) => /* HTML */ `<li>${escape(error)}</li>`).join("")}
          </ul>`
        : '<p class="validation-success">✓ This edition passed validation. Preview the slate before publishing.</p>';
    return { puzzle, errors };
  }

  function changed(event) {
    if (!authorized || writing) return;
    if (["puzzle-date", "owner-league"].includes(event.target.id)) return;
    if (!event.target.closest("#editor") && !event.target.closest("#credit-panel")) return;
    dirty = true;
    setDocumentState();
    if (event.target.closest("#cross-fields") || event.target.id === "cross-size") paintGrid();
    clearTimeout(localTimer);
    localTimer = setTimeout(() => {
      const data = collect();
      if (data.date && saveDraft(data))
        $("#save-status").textContent =
          "Working copy autosaved on this device. Firebase is unchanged.";
    }, 600);
  }

  root.addEventListener("input", changed, { signal: controller.signal });
  root.addEventListener("change", changed, { signal: controller.signal });

  async function refreshSchedule() {
    if (!authorized) {
      toast("Sign in with an owner account to view Firebase slates.");
      return;
    }
    try {
      const list = await upcomingPuzzles(connection, dateKey(), currentLeague);
      if (!authorized) return;
      $("#schedule-list").innerHTML = list.length
        ? list
            .map(
              (item) =>
                /* HTML */ `<div class="schedule-item">
                  <div>
                    <strong>${escape(item.date)}</strong
                    ><span
                      >${item.published
                        ? item.unlockAt.toMillis() <= Date.now()
                          ? "Live · Locked"
                          : "Scheduled"
                        : "Private draft"}</span
                    >
                  </div>
                  <button class="text-button" data-load="${escape(item.date)}">
                    Open ${icon("arrow-right")}
                  </button>
                </div>`,
            )
            .join("")
        : '<p class="fine-print">No upcoming slates. Save a draft or schedule your first date.</p>';
    } catch {
      toast("The Firebase schedule couldn't be loaded. Check your connection and owner rules.");
    }
  }

  async function loadDate() {
    if (!authorized || writing) return;
    const date = $("#puzzle-date").value;
    if (!date) {
      toast("Choose a release date first.");
      return;
    }
    clearTimeout(localTimer);
    writing = true;
    setDocumentState();
    let cloud = null;
    try {
      cloud = await loadOwnerPuzzle(connection, date, currentLeague);
      if (!authorized) return;
      revisionDate = authorized ? date : null;
      revisionLeague = currentLeague;
      revision = cloud?.revision ?? 0;
      live = Boolean(cloud?.published && cloud.unlockAt.toMillis() <= Date.now());
      const data = cloud
        ? { ...cloud.puzzle, credits: cloud.credits || {} }
        : getDraft(date, currentLeague) || blankSlate(date, currentLeague);
      renderFields(data);
      setDocumentState(
        live
          ? "Live · Locked"
          : cloud
            ? cloud.published
              ? "Scheduled"
              : "Firebase draft"
            : "New date · Local draft",
      );
      $("#validation-result").textContent = "";
      $("#save-status").textContent = cloud
        ? live
          ? "This slate is live. Answers and clues are locked. You can still correct creator names below."
          : "Loaded from Firebase. Import or edit the remaining games, then validate the complete slate before scheduling."
        : "New or local draft. Import games one at a time, or build the slate here.";
      rememberRevision();
    } catch (error) {
      if (!authorized) return;
      renderFields(getDraft(date, currentLeague) || blankSlate(date, currentLeague));
      revisionDate = null;
      revision = 0;
      live = false;
      toast(error.message || "Couldn't load this date from Firebase.");
    } finally {
      writing = false;
      setDocumentState();
    }
  }

  async function publish(toPublic) {
    if (!authorized || writing) return;
    const { puzzle, errors } = validate();
    if (errors.length) {
      toast("Fix the validation errors before saving.");
      return;
    }
    if (puzzle.date !== revisionDate || currentLeague !== revisionLeague) {
      toast("Use Load date first, then review this slate before saving to Firebase.");
      return;
    }
    writing = true;
    setDocumentState();
    try {
      revision = await saveOwnerPuzzle(connection, puzzle, toPublic, revision);
      current = structuredClone(puzzle);
      dirty = false;
      live = toPublic && releaseTime(puzzle.date) <= Date.now();
      saveDraft(puzzle);
      rememberRevision();
      const label = toPublic ? (live ? "Live · Locked" : "Scheduled") : "Firebase draft";
      setDocumentState(label);
      $("#save-status").textContent = toPublic
        ? live
          ? "Published. Today's games are now live."
          : `Scheduled for ${puzzle.date} at midnight Eastern.`
        : "Saved a private Firebase draft. Players cannot read it.";
      await refreshSchedule();
    } catch (error) {
      $("#save-status").textContent =
        error.code === "permission-denied"
          ? "Firebase rejected this write. Check owner access, rules, and whether this slate is already live."
          : error.message;
    } finally {
      writing = false;
      setDocumentState();
    }
  }

  $("#owner-league").addEventListener("change", async (event) => {
    if (!authorized || writing) return;
    clearTimeout(localTimer);
    saveDraft(collect());
    currentLeague = event.target.value;
    revisionDate = null;
    revision = 0;
    live = false;
    await loadDate();
  });
  $("#puzzle-date").addEventListener("change", () => {
    clearTimeout(localTimer);
    if (current?.date) saveDraft({ ...collect(), date: current.date });
    loadDate();
  });
  $("#load-date").addEventListener("click", loadDate);
  $("#refresh-schedule").addEventListener("click", refreshSchedule);
  $("#validate").addEventListener("click", () => {
    validate();
    paintGrid();
  });
  $("#save-cloud").addEventListener("click", () => publish(false));
  $("#publish").addEventListener("click", () => publish(true));
  $("#save-local").addEventListener("click", () => {
    const data = collect();
    if (!data.date) {
      toast("Choose a date before saving a working copy.");
      return;
    }
    if (saveDraft(data)) {
      dirty = false;
      setDocumentState("Local draft saved");
      $("#save-status").textContent = "Saved on this device. Nothing has been published.";
    } else toast("Your browser couldn't save this draft. Export a JSON copy to keep it.");
  });
  $("#preview").addEventListener("click", async () => {
    if (!authorized || writing) return;
    const { puzzle, errors } = validate();
    if (errors.length) {
      toast("Fix validation errors before previewing.");
      return;
    }
    saveDraft(puzzle);
    rememberRevision();
    writing = true;
    setDocumentState();
    const button = $("#preview");
    button.disabled = true;
    button.textContent = "Preparing editions…";
    try {
      const editions = await collectPreviewEditions(puzzle, {
        draftFor: (league) => getDraft(puzzle.date, league),
        loadSaved: async (league) => {
          const saved = await withTimeout(loadOwnerPuzzle(connection, puzzle.date, league), 4000);
          return saved ? { ...saved.puzzle, credits: saved.credits || {} } : null;
        },
      });
      if (!authorized) return;
      if (!writePreview(puzzle, null, editions)) {
        toast("Preview needs browser session storage. Check your browser settings.");
        return;
      }
      dirty = false;
      location.assign(`./index.html?preview=1&league=${leagueOf(puzzle)}`);
    } catch (error) {
      if (authorized) toast(error.message || "The preview couldn't be prepared. Please try again.");
    } finally {
      writing = false;
      setDocumentState();
      button.disabled = false;
      button.innerHTML = `Preview editions ${icon("arrow-up-right")}`;
    }
  });
  $("#start-sample").addEventListener("click", () => {
    const date = $("#puzzle-date").value || dateKey();
    const copy = {
      ...structuredClone(sample),
      date,
      ...(currentLeague !== "general" ? { league: currentLeague } : {}),
    };
    if (currentLeague !== "general") {
      delete copy.gridIron;
      delete copy.twoMinuteDrill;
      toast(
        "Sample layout loaded. Replace the sample content with questions for your selected league.",
      );
    }
    renderFields(copy);
    dirty = true;
    setDocumentState("Sample loaded · Not published");
    toast("Sample loaded into the editor. Nothing has been published.");
  });
  $("#add-entry").addEventListener("click", () => {
    const entries = collect().crossSport.entries;
    if (entries.length >= 40) {
      toast("A crossword can have up to 40 entries.");
      return;
    }
    entries.push({ row: 0, col: 0, direction: "across", answer: "", clue: "" });
    renderEntries(entries);
    dirty = true;
    setDocumentState();
    paintGrid();
  });
  root.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove]");
    if (remove) {
      const entries = collect().crossSport.entries.filter((_, i) => i !== +remove.dataset.remove);
      renderEntries(entries);
      dirty = true;
      setDocumentState();
      paintGrid();
    }
    const load = event.target.closest("[data-load]");
    if (load) {
      $("#puzzle-date").value = load.dataset.load;
      loadDate();
    }
  });
  function inspectImport() {
    parsedImport = parseGameImport($("#game-import-json").value);
    $("#import-summary").textContent =
      `${GAME_NAMES[parsedImport.game]}${parsedImport.creatorCredit ? ` · Submitted by ${parsedImport.creatorCredit}` : ""} · Selected date: ${$("#puzzle-date").value}`;
    return parsedImport;
  }
  function importError(error) {
    $("#import-summary").textContent = error.message || "The game couldn't be imported.";
  }
  $("#inspect-import").addEventListener("click", () => {
    try {
      inspectImport();
    } catch (error) {
      parsedImport = null;
      importError(error);
    }
  });
  $("#import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 60000) throw new Error("Import one game JSON file smaller than 60 KB.");
      $("#game-import-json").value = await file.text();
      inspectImport();
    } catch (error) {
      parsedImport = null;
      importError(error);
    } finally {
      event.target.value = "";
    }
  });
  async function importSelectedGame(replace = false) {
    if (!authorized || writing || live) return;
    try {
      const envelope = inspectImport();
      const date = $("#puzzle-date").value;
      if (!validDate(date)) throw new Error("Choose a release date first.");
      if (authorized && date !== revisionDate)
        throw new Error("Use Load date before importing so existing games can be checked safely.");
      const before = collect();
      if (!replace && !validateGame(envelope.game, before[GAME_FIELDS[envelope.game]]).length) {
        $("#import-confirm-message").textContent = gameImportMessage(envelope.game, date);
        replaceImport = true;
        $("#import-confirm").showModal();
        return;
      }
      writing = true;
      setDocumentState();
      const baseline = structuredClone(current);
      const result = await importOwnerGame(
        connection,
        date,
        envelope,
        revision,
        replace,
        currentLeague,
      );
      const cloud = editorSlate(result.slate, date, currentLeague);
      const view = structuredClone(cloud);
      let retainedEdits = false;
      // Preserve unsaved edits to OTHER games in the working copy. They are
      // never smuggled into the field-specific Firebase import transaction.
      for (const game of GAMES)
        if (game !== envelope.game) {
          const field = GAME_FIELDS[game];
          if (!samePuzzleData(before[field], baseline[field])) {
            view[field] = before[field];
            retainedEdits = true;
          }
          if (!samePuzzleData(before.credits[game], baseline.credits?.[game])) {
            if (before.credits[game]) view.credits[game] = before.credits[game];
            else delete view.credits[game];
            retainedEdits = true;
          }
        }
      if (before.title !== baseline.title) {
        view.title = before.title;
        retainedEdits = true;
      }
      revision = result.revision;
      revisionDate = date;
      live = false;
      renderFields(view);
      current = cloud;
      dirty = retainedEdits;
      saveDraft(view);
      rememberRevision();
      $("#save-status").textContent = [
        `Imported ${GAME_NAMES[envelope.game]} for ${date}. Other games and their credits were retained.`,
        retainedEdits ? "Your other unsaved edits remain in the editor." : "",
        result.published
          ? "This future slate remains scheduled."
          : "Complete this edition, then publish or schedule the slate.",
      ]
        .filter(Boolean)
        .join(" ");
      await refreshSchedule();
    } catch (error) {
      if (error.code === "import/overwrite-required") {
        $("#import-confirm-message").textContent = gameImportMessage(
          parsedImport.game,
          $("#puzzle-date").value,
        );
        replaceImport = true;
        $("#import-confirm").showModal();
      } else importError(error);
    } finally {
      writing = false;
      setDocumentState();
    }
  }
  $("#import-game").addEventListener("click", () => importSelectedGame());
  $("#import-cancel").addEventListener("click", () => {
    replaceImport = false;
    $("#import-confirm").close();
  });
  $("#import-replace").addEventListener("click", () => {
    if (!replaceImport) return;
    replaceImport = false;
    $("#import-confirm").close();
    importSelectedGame(true);
  });
  $("#export").addEventListener("click", () => {
    try {
      downloadGame(exportGameFromSlate(collect(), $("#export-game").value));
    } catch (error) {
      importError(error);
    }
  });
  $("#copy-game-json").addEventListener("click", async () => {
    try {
      const envelope = exportGameFromSlate(collect(), $("#export-game").value);
      $("#game-import-json").value = JSON.stringify(envelope, null, 2);
      inspectImport();
      await navigator.clipboard.writeText($("#game-import-json").value);
      toast("Selected game JSON copied.");
    } catch (error) {
      importError(error);
      $("#game-import-json").focus();
      $("#game-import-json").select();
    }
  });
  $("#save-credit-names").addEventListener("click", async () => {
    if (!authorized || writing || !revisionDate) return;
    if ($("#puzzle-date").value !== revisionDate) {
      toast("Load this date before correcting its creator names.");
      return;
    }
    writing = true;
    setDocumentState();
    try {
      const puzzle = collect();
      revision = await saveOwnerCredits(
        connection,
        puzzle.date,
        puzzle.credits,
        revision,
        currentLeague,
      );
      current.credits = structuredClone(puzzle.credits);
      rememberRevision();
      saveDraft(puzzle);
      dirty = !samePuzzleData(collect(), current);
      $("#credit-status").textContent =
        "Creator names saved. Answers, clues, scores, and release settings are unchanged.";
    } catch (error) {
      $("#credit-status").textContent = error.message || "Creator names couldn't be saved.";
    } finally {
      writing = false;
      setDocumentState();
    }
  });

  window.addEventListener(
    "beforeunload",
    (event) => {
      if (authorized && dirty && !saveDraft(collect())) {
        event.preventDefault();
        event.returnValue = "";
      }
    },
    { signal: controller.signal },
  );

  const ready = (async () => {
    const response = await fetch(new URL("../data/practice.json", import.meta.url), {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("The editor couldn't load. Please try signing in again.");
    sample = await response.json();
    if (!authorized) return;
    if (validatePuzzle(sample).length) throw new Error("The sample slate is unavailable.");
    const lastDate = readLocal("owner-last-date");
    const chosenDate = validDate(lastDate) ? lastDate : dateKey();
    currentLeague = readLocal("owner-last-league", "general");
    if (!LEAGUE_NAMES[currentLeague]) currentLeague = "general";
    revisionLeague = currentLeague;
    const local = getDraft(chosenDate, currentLeague);
    renderFields(
      local && local.schemaVersion === 1 ? local : blankSlate(chosenDate, currentLeague),
    );
    await loadDate();
    if (authorized) refreshSchedule();
  })();
  return {
    ready,
    destroy() {
      authorized = false;
      appearance.destroy();
      clearTimeout(localTimer);
      clearTimeout(toastTimer);
      controller.abort();
      root.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
      root.remove();
    },
  };
}
