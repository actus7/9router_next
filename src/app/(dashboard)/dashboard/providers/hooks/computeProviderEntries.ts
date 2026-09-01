"use client";

import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, getProviderConnectionAuthTypes } from "@/shared/constants/providers";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { getProviderStats, matchSearch, sortByPriority } from "../utils/providerHelpers";
import type { Connection, ProviderNode, ProviderInfo } from "../types";

export function computeCompatibleProviders(providerNodes: ProviderNode[], searchQuery: string) {
  const ms = (name: string) => matchSearch(searchQuery, name);
  const compatible = providerNodes.filter((n) => n.type === "openai-compatible").map((n) => ({ id: n.id, alias: n.id, category: "apikey" as const, name: n.name || "OpenAI Compatible", color: "#10A37F", textIcon: "OC", apiType: n.apiType })).filter((p) => ms(p.name));
  const anthropic = providerNodes.filter((n) => n.type === "anthropic-compatible").map((n) => ({ id: n.id, alias: n.id, category: "apikey" as const, name: n.name || "Anthropic Compatible", color: "#D97757", textIcon: "AC" })).filter((p) => ms(p.name));
  return { compatibleProviders: compatible, anthropicCompatibleProviders: anthropic };
}

export function computeProviderEntries(searchQuery: string, connections: Connection[]) {
  const ms = (name: string) => matchSearch(searchQuery, name);
  const gs = (id: string, auth: string | string[]) => getProviderStats(connections, id, auth, normalizeProviderId);

  const oauthEntries = sortByPriority(
    (Object.entries(OAUTH_PROVIDERS) as unknown as [string, ProviderInfo][]).filter(([, info]) => !info.hidden && ms(info.name)),
    "oauth", gs,
  );

  const freeEntries = (Object.entries(FREE_PROVIDERS) as unknown as [string, ProviderInfo][])
    .filter(([, info]) => !info.hidden && ms(info.name))
    .sort(([, a], [, b]) => (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0));

  const freeTierEntries = (Object.entries(FREE_TIER_PROVIDERS) as unknown as [string, ProviderInfo][])
    .filter(([, info]) => !info.hidden && ms(info.name) && (info.serviceKinds ?? ["llm"]).includes("llm"))
    .sort(([ka, a], [kb, b]) => {
      const pa = a.priority ?? 999; const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const noAuthDiff = (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0);
      if (noAuthDiff !== 0) return noAuthDiff;
      const ca = gs(ka, getProviderConnectionAuthTypes(a)).connected > 0 ? 0 : 1;
      const cb = gs(kb, getProviderConnectionAuthTypes(b)).connected > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });

  const apikeyEntries = (Object.entries(APIKEY_PROVIDERS) as unknown as [string, ProviderInfo][])
    .filter(([, info]) => !info.hidden && (info.serviceKinds ?? ["llm"]).includes("llm") && ms(info.name))
    .sort(([ka, a], [kb, b]) => {
      const ca = gs(ka, "apikey").total > 0 ? 0 : 1;
      const cb = gs(kb, "apikey").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });

  const webCookieEntries = (Object.entries(WEB_COOKIE_PROVIDERS) as unknown as [string, ProviderInfo][])
    .filter(([, info]) => !info.hidden && ms(info.name))
    .sort(([ka, a], [kb, b]) => {
      const ca = gs(ka, "cookie").total > 0 ? 0 : 1;
      const cb = gs(kb, "cookie").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });

  return { oauthEntries, freeEntries, freeTierEntries, apikeyEntries, webCookieEntries };
}
