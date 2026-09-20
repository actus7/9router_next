"use client";

import type { ModelItem, ModelGroup } from "./buildGroupedModels";

const byName = (a: ModelItem, b: ModelItem) => a.name.localeCompare(b.name);

function sortModels(models: ModelItem[], addedModelValues: string[]): ModelItem[] {
  // `includes` por modelo era O(n·m), em duas passagens sobre a mesma lista.
  // O catálogo é descoberto do provider — um só deles passa de 300 modelos.
  const addedValues = new Set(addedModelValues);
  const added: ModelItem[] = [];
  const rest: ModelItem[] = [];
  for (const model of models) (addedValues.has(model.value) ? added : rest).push(model);
  added.sort(byName);
  rest.sort(byName);
  return [...added, ...rest];
}

export function filterAndSortGroups(params: {
  groupedModels: Record<string, ModelGroup>;
  searchQuery: string;
  capFilter: string | null;
  addedModelValues: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCaps: (value: string) => any;
}): Record<string, ModelGroup> {
  const { groupedModels, searchQuery, capFilter, addedModelValues, getCaps } = params;
  const query = searchQuery.trim().toLowerCase();
  const filtered: Record<string, ModelGroup> = {};
  Object.entries(groupedModels).forEach(([providerId, group]) => {
    let models = group.models;
    if (capFilter) {
      models = models.filter((m) => (getCaps(m.value) as Record<string, boolean> | null)?.[capFilter] === true);
      if (models.length === 0) return;
    }
    if (query) {
      const providerNameMatches = group.name.toLowerCase().includes(query);
      models = models.filter((m) => m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query));
      if (models.length === 0 && !providerNameMatches) return;
    }
    filtered[providerId] = { ...group, models: sortModels(models, addedModelValues) };
  });
  return filtered;
}
