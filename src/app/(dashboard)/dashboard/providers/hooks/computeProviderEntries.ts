"use client";

import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, getProviderConnectionAuthTypes } from "@/shared/constants/providers";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { getProviderStats, matchSearch, sortByPriority } from "../utils/providerHelpers";
import type { Connection, ProviderNode, ProviderInfo } from "../types";
import { getTypesafeProviderStats, TYPESAFE_PROVIDER, TYPESAFE_SETTINGS_HREF } from "../typesafeProvider";

export function computeCompatibleProviders(providerNodes: ProviderNode[], searchQuery: string) {
  const ms = (name: string) => matchSearch(searchQuery, name);
  const compatible = providerNodes.filter((n) => n.type === "openai-compatible").map((n) => ({ id: n.id, alias: n.id, category: "apikey" as const, name: n.name || "OpenAI Compatible", color: "#10A37F", textIcon: "OC", apiType: n.apiType })).filter((p) => ms(p.name));
  const anthropic = providerNodes.filter((n) => n.type === "anthropic-compatible").map((n) => ({ id: n.id, alias: n.id, category: "apikey" as const, name: n.name || "Anthropic Compatible", color: "#D97757", textIcon: "AC" })).filter((p) => ms(p.name));
  return { compatibleProviders: compatible, anthropicCompatibleProviders: anthropic };
}

/** What a provider serves, minus the kinds it hides from listings. Unset means chat only. */
export function providerKinds(info: ProviderInfo): string[] {
  const hidden = (info.hiddenKinds as string[] | undefined) ?? [];
  return (info.serviceKinds ?? ["llm"]).filter((k) => !hidden.includes(k));
}

// Kind chips are OR: a provider shows when it serves any selected kind. None selected = all.
const servesAny = (info: ProviderInfo, kinds: readonly string[]) =>
  kinds.length === 0 || providerKinds(info).some((k) => kinds.includes(k));

/**
 * Chat providers configure on /providers/[id]; a media kind (voices, image
 * params…) configures on /media-providers/[kind]/[id]. The selected chips pick
 * which one a multi-kind provider opens on.
 */
// Kinds configured on the provider page itself; every other kind has a media page.
const PROVIDER_PAGE_KINDS = ["llm", "systemOne"];

export function providerHref(id: string, info: ProviderInfo, selectedKinds: readonly string[] = []): string {
  if (id === TYPESAFE_PROVIDER.id) return TYPESAFE_SETTINGS_HREF;
  const kinds = providerKinds(info);
  const mediaKind = selectedKinds.find((k) => !PROVIDER_PAGE_KINDS.includes(k) && kinds.includes(k));
  if (mediaKind) return `/dashboard/media-providers/${mediaKind}/${id}`;
  if (kinds.length === 0 || kinds.some((k) => PROVIDER_PAGE_KINDS.includes(k))) return `/dashboard/providers/${id}`;
  return `/dashboard/media-providers/${kinds[0]}/${id}`;
}

export function computeProviderEntries(searchQuery: string, connections: Connection[], selectedKinds: readonly string[] = [], hasTypesafeKey: boolean | null = null) {
  const ms = (name: string) => matchSearch(searchQuery, name);
  const isListedProvider = (info: ProviderInfo) => !info.hidden && servesAny(info, selectedKinds);
  // A retired provider leaves the regular groups and is listed under "Depreciados".
  const isListed = (info: ProviderInfo) => isListedProvider(info) && !info.retired;
  const gs = (id: string, auth: string | string[]) => id === TYPESAFE_PROVIDER.id
    ? getTypesafeProviderStats(hasTypesafeKey)
    : getProviderStats(connections, id, auth, normalizeProviderId);

  const oauthEntries = sortByPriority(
    (Object.entries(OAUTH_PROVIDERS) as unknown as [string, ProviderInfo][]).filter(([, info]) => isListed(info) && ms(info.name)),
    "oauth", gs,
  );

  const freeEntries = (Object.entries(FREE_PROVIDERS) as unknown as [string, ProviderInfo][])
    .filter(([, info]) => isListed(info) && ms(info.name))
    .sort(([, a], [, b]) => (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0));

  const freeTierEntries = (Object.entries(FREE_TIER_PROVIDERS) as unknown as [string, ProviderInfo][])
    .filter(([, info]) => isListed(info) && ms(info.name))
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

  const apikeyProviders: [string, ProviderInfo][] = [
    ...(Object.entries(APIKEY_PROVIDERS) as unknown as [string, ProviderInfo][]),
    [TYPESAFE_PROVIDER.id, TYPESAFE_PROVIDER],
  ];
  const apikeyEntries = apikeyProviders
    .filter(([, info]) => isListed(info) && ms(info.name))
    .sort(([ka, a], [kb, b]) => {
      const ca = gs(ka, "apikey").total > 0 ? 0 : 1;
      const cb = gs(kb, "apikey").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });

  const webCookieEntries = (Object.entries(WEB_COOKIE_PROVIDERS) as unknown as [string, ProviderInfo][])
    .filter(([, info]) => isListed(info) && ms(info.name))
    .sort(([ka, a], [kb, b]) => {
      const ca = gs(ka, "cookie").total > 0 ? 0 : 1;
      const cb = gs(kb, "cookie").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });

  const retiredEntries = [OAUTH_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, APIKEY_PROVIDERS, WEB_COOKIE_PROVIDERS]
    .flatMap((group) => Object.entries(group) as unknown as [string, ProviderInfo][])
    .filter(([, info]) => isListedProvider(info) && !!info.retired && ms(info.name))
    .sort(([, a], [, b]) => (a.name || "").localeCompare(b.name || ""));

  return { oauthEntries, freeEntries, freeTierEntries, apikeyEntries, webCookieEntries, retiredEntries };
}
