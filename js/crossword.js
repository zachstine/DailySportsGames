export function firstAcross(model) {
  return (
    model.entries
      .filter((entry) => entry.direction === "across")
      .sort((a, b) => a.number - b.number)[0] || model.entries[0]
  );
}

export function crossSelection(model, entryId, cell, nextCell, toggle = false) {
  const choices = model.cells[nextCell].entries;
  const entry =
    toggle && nextCell === cell && choices.length > 1
      ? choices.find((id) => id !== entryId)
      : choices.includes(entryId)
        ? entryId
        : (choices.find((id) => model.entries.find((e) => e.id === id).direction === "across") ??
          choices[0]);
  return { entry, cell: nextCell };
}
