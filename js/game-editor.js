import { buildCrossword, GAME_NAMES, validateGame } from "./core.js";
import { parseDrillAnswers, formatDrillAnswers } from "./new-games.js";
import { blankGame } from "./puzzles.js";
import { icon } from "./icons.js";

export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
const aliases = (value) =>
  value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const clueStages = [
  "Distinctive stat or fact",
  "Supporting detail",
  "Career context",
  "Team or era",
  "Signature clue",
];

export class GameEditor {
  constructor(root, prefix) {
    this.root = root;
    this.prefix = prefix;
    root.addEventListener("input", () => {
      this.data = this.read();
      this.paintGrid();
      this.changed();
    });
    root.addEventListener("change", () => {
      this.data = this.read();
      this.paintGrid();
      this.changed();
    });
    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-edit-action]");
      if (!button) return;
      this.data = this.read();
      const { editAction: action, index } = button.dataset;
      const i = +index;
      const list =
        this.game === "player"
          ? this.data.hints
          : this.game === "ladder"
            ? this.data.questions
            : this.data.entries;
      if (action === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      if (action === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
      if (action === "remove") list.splice(i, 1);
      if (action === "add-hint" && list.length < 5) list.push("");
      if (action === "add-entry" && list.length < 40)
        list.push({
          answer: "",
          clue: "",
          row: 0,
          col: 0,
          direction: list.length ? "down" : "across",
        });
      this.render();
      this.changed();
    });
  }
  changed() {
    this.root.dispatchEvent(new CustomEvent("game-edit", { bubbles: true }));
  }
  set(game, data) {
    this.game = game;
    this.data = structuredClone(data || blankGame(game));
    this.render();
  }
  field(
    key,
    label,
    value = "",
    { type = "text", textarea = false, max = 120, min, placeholder = "" } = {},
  ) {
    const id = `${this.prefix}-${key}`;
    return /* HTML */ `<div class="field">
      <label for="${id}">${label}</label>${textarea
        ? /* HTML */ `<textarea id="${id}" data-field="${key}" rows="2" maxlength="${max}">
${escape(value)}</textarea
          >`
        : /* HTML */ `<input
            id="${id}"
            data-field="${key}"
            type="${type}"
            value="${escape(value)}"
            maxlength="${max}"
            ${min !== undefined ? `min="${min}" max="11"` : ""}
            placeholder="${escape(placeholder)}"
            autocomplete="off"
          />`}
    </div>`;
  }
  moves(i, length, noun, remove = false) {
    return /* HTML */ `<div class="edit-moves">
      <button
        type="button"
        class="text-button"
        data-edit-action="up"
        data-index="${i}"
        aria-label="Move ${noun} ${i + 1} up"
        ${i === 0 ? "disabled" : ""}
      >
        ${icon("arrow-up")} Move up</button
      ><button
        type="button"
        class="text-button"
        data-edit-action="down"
        data-index="${i}"
        aria-label="Move ${noun} ${i + 1} down"
        ${i === length - 1 ? "disabled" : ""}
      >
        ${icon("arrow-down")} Move down</button
      >${remove
        ? /* HTML */ `<button
            type="button"
            class="remove-entry"
            data-edit-action="remove"
            data-index="${i}"
            aria-label="Remove ${noun} ${i + 1}"
          >
            Remove
          </button>`
        : ""}
    </div>`;
  }
  render() {
    const d = this.data;
    if (this.game === "player")
      this.root.innerHTML = /* HTML */ `<p class="fine-print">
          One player, exactly five clues. Start with a precise stat or distinctive career fact that
          a fan could recognize immediately. Add useful context with each clue. Check the season and
          numbers.
        </p>
        <div class="field-row">
          ${this.field("answer", "Correct player", d.answer)}${this.field(
            "sport",
            "Sport or league",
            d.sport,
            { max: 30 },
          )}
        </div>
        ${this.field(
          "aliases",
          "Other accepted names or nicknames · separate with commas",
          d.aliases.join(", "),
          { max: 2400 },
        )}${d.hints
          .map(
            (hint, i) =>
              /* HTML */ `<section class="editor-item">
                <h3>Clue ${i + 1} · ${clueStages[i]}</h3>
                ${this.field(`hint-${i}`, `Clue ${i + 1}`, hint, {
                  textarea: true,
                  max: 500,
                })}${this.moves(i, d.hints.length, "clue", true)}
              </section>`,
          )
          .join("")}<button
          type="button"
          class="button secondary"
          data-edit-action="add-hint"
          ${d.hints.length >= 5 ? "disabled" : ""}
        >
          + Add clue (${d.hints.length}/5)
        </button>`;
    if (this.game === "ladder")
      this.root.innerHTML = /* HTML */ `<p class="fine-print">
          Five questions, from easy to hard. Each gets one guess. Rungs are worth 1–5 points. Name
          the exact season, statistic, and regular season or playoffs. Add a reliable source link.
        </p>
        ${d.questions
          .map(
            (q, i) =>
              /* HTML */ `<section class="editor-item">
                <h3>Rung ${i + 1} · ${i + 1} point${i ? "s" : ""}</h3>
                ${this.field(`question-${i}`, `Question ${i + 1}`, q.question, {
                  textarea: true,
                  max: 500,
                })}
                <div class="field-row">
                  ${this.field(`answer-${i}`, `Answer ${i + 1}`, q.answer)}${this.field(
                    `sport-${i}`,
                    `Sport or league ${i + 1}`,
                    q.sport,
                    { max: 30 },
                  )}
                </div>
                ${this.field(
                  `aliases-${i}`,
                  `Other accepted answers ${i + 1} · comma separated`,
                  q.aliases.join(", "),
                  { max: 2400 },
                )}${this.field(`source-${i}`, `Source URL ${i + 1}`, q.source, {
                  type: "url",
                  max: 2000,
                  placeholder: "https://...",
                })}${this.moves(i, 5, "question")}
              </section>`,
          )
          .join("")}`;
    if (this.game === "cross")
      this.root.innerHTML = /* HTML */ `<p class="fine-print">
          Place sports names and phrases on a 5–11 square grid. Rows and columns start at 1. Words
          must connect; every adjoining word needs a clue. Black squares and clue numbers are
          automatic.
        </p>
        <div class="field field-compact">
          <label for="${this.prefix}-size">Grid size</label
          ><select id="${this.prefix}-size" data-field="size">
            ${[5, 6, 7, 8, 9, 10, 11]
              .map((n) => /* HTML */ `<option ${d.size === n ? "selected" : ""}>${n}</option>`)
              .join("")}
          </select>
        </div>
        ${d.entries
          .map(
            (e, i) =>
              /* HTML */ `<section class="editor-item">
                <h3>Word ${i + 1}</h3>
                <div class="field-row">
                  ${this.field(`word-${i}`, `Answer ${i + 1}`, e.answer, { max: 30 })}${this.field(
                    `clue-${i}`,
                    `Sports clue ${i + 1}`,
                    e.clue,
                    { max: 500 },
                  )}
                </div>
                <div class="cross-coordinates">
                  ${this.field(`row-${i}`, `Start row ${i + 1}`, e.row + 1, {
                    type: "number",
                    min: 1,
                  })}${this.field(`col-${i}`, `Start column ${i + 1}`, e.col + 1, {
                    type: "number",
                    min: 1,
                  })}
                  <div class="field">
                    <label for="${this.prefix}-direction-${i}">Direction ${i + 1}</label
                    ><select id="${this.prefix}-direction-${i}" data-field="direction-${i}">
                      <option value="across" ${e.direction === "across" ? "selected" : ""}>
                        Across
                      </option>
                      <option value="down" ${e.direction === "down" ? "selected" : ""}>Down</option>
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  class="remove-entry"
                  data-edit-action="remove"
                  data-index="${i}"
                  aria-label="Remove word ${i + 1}"
                >
                  Remove word
                </button>
              </section>`,
          )
          .join("")}<button
          type="button"
          class="button secondary"
          data-edit-action="add-entry"
          ${d.entries.length >= 40 ? "disabled" : ""}
        >
          + Add word
        </button>
        <div class="editor-cross-preview">
          <h3>Grid preview</h3>
          <div class="editor-grid" data-editor-grid aria-label="Your crossword grid"></div>
          <p class="fine-print" data-grid-note role="status"></p>
        </div>`;
    if (this.game === "grid")
      this.root.innerHTML = /* HTML */ `<p class="fine-print">
          Enter nine players or coaches, separated by commas. Add a stat or clue in each square and
          choose its matching name. Each name must be used once.
        </p>
        ${this.field("names", "Nine names · comma separated", d.names.join(", "), {
          textarea: true,
          max: 1200,
        })}
        <div class="owner-match-grid">
          ${d.cells
            .map(
              (cell, i) =>
                /* HTML */ `<section class="editor-item">
                  <h3>
                    ${["Top", "Middle", "Bottom"][Math.floor(i / 3)]}
                    ${["left", "center", "right"][i % 3]}
                  </h3>
                  ${this.field(`cell-${i}`, `Clue for square ${i + 1}`, cell.clue, {
                    textarea: true,
                    max: 500,
                  })}
                  <div class="field">
                    <label for="${this.prefix}-match-${i}">Correct name for square ${i + 1}</label
                    ><select id="${this.prefix}-match-${i}" data-field="match-${i}">
                      <option value="">Choose name</option>
                      ${d.names
                        .map(
                          (name, n) =>
                            /* HTML */ `<option
                              value="${n}"
                              ${cell.answer && cell.answer === name ? "selected" : ""}
                            >
                              ${escape(name || `Name ${n + 1}`)}
                            </option>`,
                        )
                        .join("")}
                    </select>
                  </div>
                </section>`,
            )
            .join("")}
        </div>`;
    if (this.game === "drill")
      this.root.innerHTML = /* HTML */ `<p class="fine-print">
          One question. Unlimited guesses. A fixed 120-second clock. Each unique answer earns one
          point.
        </p>
        ${this.field("question", "Daily question or category", d.question, {
          textarea: true,
          max: 500,
        })}${this.field(
          "answers",
          "Accepted answers · separated by commas",
          formatDrillAnswers(d.answers),
          { textarea: true, max: 50000 },
        )}
        <p class="field-help">
          Example: Patrick Mahomes, Wes Welker. A comma starts a new answer; an optional | adds an
          alias for that answer. Full names and unique last names are accepted automatically; first
          names alone are rejected. Capitalization, spacing, accents, and punctuation are ignored.
          Up to 500 answers. Verify the complete list before publishing.
        </p>`;
    this.paintGrid();
  }
  read() {
    const value = (key) => this.root.querySelector(`[data-field="${key}"]`)?.value.trim() ?? "";
    if (this.game === "player")
      return {
        answer: value("answer"),
        sport: value("sport"),
        aliases: aliases(value("aliases")),
        hints: this.data.hints.map((_, i) => value(`hint-${i}`)),
      };
    if (this.game === "ladder")
      return {
        questions: this.data.questions.map((_, i) => ({
          question: value(`question-${i}`),
          answer: value(`answer-${i}`),
          sport: value(`sport-${i}`),
          aliases: aliases(value(`aliases-${i}`)),
          source: value(`source-${i}`),
        })),
      };
    if (this.game === "grid") {
      const names = value("names")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      return {
        names,
        cells: this.data.cells.map((_, i) => ({
          clue: value(`cell-${i}`),
          answer: value(`match-${i}`) === "" ? "" : names[+value(`match-${i}`)] || "",
        })),
      };
    }
    if (this.game === "drill")
      return { question: value("question"), answers: parseDrillAnswers(value("answers")) };
    return {
      size: +value("size"),
      entries: this.data.entries.map((_, i) => ({
        answer: value(`word-${i}`),
        clue: value(`clue-${i}`),
        row: +value(`row-${i}`) - 1,
        col: +value(`col-${i}`) - 1,
        direction: value(`direction-${i}`),
      })),
    };
  }
  errors() {
    return validateGame(this.game, this.read());
  }
  paintGrid() {
    if (this.game === "grid") {
      for (let i = 0; i < 9; i++) {
        const select = this.root.querySelector(`[data-field="match-${i}"]`);
        const selected = select.value;
        select.innerHTML = /* HTML */ `<option value="">Choose name</option>
          ${this.data.names
            .map((name, n) => /* HTML */ `<option value="${n}">${escape(name)}</option>`)
            .join("")}`;
        select.value = selected;
      }
    }
    if (this.game !== "cross") return;
    const target = this.root.querySelector("[data-editor-grid]");
    if (!target) return;
    const model = buildCrossword(this.read());
    target.style.gridTemplateColumns = `repeat(${model.size || 5},1fr)`;
    target.innerHTML = model.cells
      ? model.cells
          .map((cell) =>
            cell
              ? /* HTML */ `<div class="editor-square">
                  ${cell.number ? /* HTML */ `<span>${cell.number}</span>` : ""}${escape(
                    cell.letter,
                  )}
                </div>`
              : '<div class="editor-square black"></div>',
          )
          .join("")
      : "";
    this.root.querySelector("[data-grid-note]").textContent = model.errors.length
      ? model.errors[0]
      : `${model.entries.length} connected entries. Ready to preview.`;
  }
}

export function showErrors(target, errors) {
  target.className = errors.length ? "notice warning" : "notice";
  target.innerHTML = errors.length
    ? /* HTML */ `<ul class="validation-errors">
        ${errors.map((error) => /* HTML */ `<li>${escape(error)}</li>`).join("")}
      </ul>`
    : "All checks passed. Your puzzle is ready to preview.";
  target.hidden = false;
}
export function downloadGame(envelope) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(envelope, null, 2) + "\n"], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `daily-sports-${envelope.game}${envelope.submissionId ? `-${envelope.submissionId}` : ""}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
