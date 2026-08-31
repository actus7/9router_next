"use client";

interface NormalizedModel {
  id: string;
  requestModel: string;
  name: string;
  providerId: string;
  providerName: string;
  source: string;
  caps?: Record<string, boolean>;
  kind?: string;
}

interface ProviderGroup {
  providerId: string;
  providerName: string;
  models: NormalizedModel[];
}

type AuthTab = "subscription" | "apikey" | "local";

export function filterModelGroups(params: {
  providerGroups: ProviderGroup[];
  search: string;
  activeTab: AuthTab;
  capFilter: Set<string>;
  hasMultipleTabs: boolean;
  classifyProvider: (id: string) => AuthTab;
  getCaps: (requestModel: string) => Record<string, boolean> | null;
}): ProviderGroup[] {
  const { providerGroups, search, activeTab, capFilter, hasMultipleTabs, classifyProvider, getCaps } = params;
  const q = search.toLowerCase().trim();
  const groups: ProviderGroup[] = [];

  for (const group of providerGroups) {
    const groupTab = classifyProvider(group.providerId);
    if (hasMultipleTabs && groupTab !== activeTab) continue;
    let models = group.models;

    if (capFilter.size > 0) {
      models = models.filter((model) => {
        const caps = (getCaps(model.requestModel) || model.caps) as Record<string, boolean> | undefined;
        if (!caps) return false;
        for (const cap of capFilter) { if (!caps[cap]) return false; }
        return true;
      });
    }

    if (q) {
      const nameMatch = group.providerName.toLowerCase().includes(q);
      models = nameMatch
        ? models
        : models.filter((m) => m.name.toLowerCase().includes(q) || m.requestModel.toLowerCase().includes(q));
    }

    if (models.length > 0) {
      groups.push({ providerId: group.providerId, providerName: group.providerName, models: models.sort((a, b) => a.name.localeCompare(b.name)) });
    }
  }
  return groups.sort((a, b) => a.providerName.localeCompare(b.providerName));
}
