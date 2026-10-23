import { LEAGUES, leagueOf, validatePuzzle } from "./core.js";

function readyFor(puzzle, date, league) {
  return puzzle?.date === date && leagueOf(puzzle) === league && !validatePuzzle(puzzle).length;
}

export function previewEditions(active, candidates = {}) {
  if (!active || !readyFor(active, active.date, leagueOf(active))) return {};
  const editions = {};
  for (const league of LEAGUES) {
    const puzzle = league === leagueOf(active) ? active : candidates?.[league];
    if (readyFor(puzzle, active.date, league)) editions[league] = structuredClone(puzzle);
  }
  return editions;
}

export async function collectPreviewEditions(active, { draftFor, loadSaved }) {
  const editions = previewEditions(active);
  if (!Object.keys(editions).length) throw new Error("Finish this edition before previewing.");
  const results = await Promise.allSettled(
    LEAGUES.filter((league) => league !== leagueOf(active)).map(async (league) => {
      // Unfinished local edits should not silently preview an older saved slate.
      const draft = draftFor(league);
      const puzzle = draft ?? (await loadSaved(league));
      return readyFor(puzzle, active.date, league) ? [league, puzzle] : null;
    }),
  );
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      const [league, puzzle] = result.value;
      editions[league] = structuredClone(puzzle);
    }
  }
  return previewEditions(active, editions);
}
