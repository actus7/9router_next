"use client";

import { useState, useEffect } from "react";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  getProviderConnectionAuthTypes,
} from "@/shared/constants/providers";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { translate } from "@/i18n/runtime";
import { normalizeProviderId } from "@/lib/providerNormalization";
import type {
  Connection,
  ProviderNode,
  ProviderInfo,
  AvailabilityFilter,
  TestResults,
} from "../types";
import {
  getProviderStats,
  availabilityFor,
  matchSearch,
  sortByPriority,
  filterByAvailability,
} from "../utils/providerHelpers";
import { useProviderActions } from "./useProviderActions";

const APIKEY_INITIAL_VISIBLE = 20;

function computeEntries(
  providerNodes: ProviderNode[],
  searchQuery: string,
  connections: Connection[],
) {
  const ms = (name: string) => matchSearch(searchQuery, name);
  const gs = (id: string, auth: string | string[]) =>
    getProviderStats(connections, id, auth, normalizeProviderId);

  const compatibleProviders = providerNodes
    .filter((node) => node.type === "openai-compatible")
    .map((node) => ({
      id: node.id,
      alias: node.id,
      category: "apikey" as const,
      name: node.name || "OpenAI Compatible",
      color: "#10A37F",
      textIcon: "OC",
      apiType: node.apiType,
    }))
    .filter((p) => ms(p.name));

  const anthropicCompatibleProviders = providerNodes
    .filter((node) => node.type === "anthropic-compatible")
    .map((node) => ({
      id: node.id,
      alias: node.id,
      category: "apikey" as const,
      name: node.name || "Anthropic Compatible",
      color: "#D97757",
      textIcon: "AC",
    }))
    .filter((p) => ms(p.name));

  const oauthEntries = sortByPriority(
    (Object.entries(OAUTH_PROVIDERS) as unknown as [string, ProviderInfo][]).filter(
      ([, info]) => !info.hidden && ms(info.name),
    ),
    "oauth",
    gs,
  );

  const freeEntries = (
    Object.entries(FREE_PROVIDERS) as unknown as [string, ProviderInfo][]
  )
    .filter(([, info]) => !info.hidden && ms(info.name))
    .sort(([, a], [, b]) => (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0));

  const freeTierEntries = (
    Object.entries(FREE_TIER_PROVIDERS) as unknown as [string, ProviderInfo][]
  )
    .filter(
      ([, info]) =>
        !info.hidden &&
        ms(info.name) &&
        (info.serviceKinds ?? ["llm"]).includes("llm"),
    )
    .sort(([ka, a], [kb, b]) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const noAuthDiff = (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0);
      if (noAuthDiff !== 0) return noAuthDiff;
      const ca = gs(ka, getProviderConnectionAuthTypes(a)).connected > 0 ? 0 : 1;
      const cb = gs(kb, getProviderConnectionAuthTypes(b)).connected > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });

  const apikeyEntries = (
    Object.entries(APIKEY_PROVIDERS) as unknown as [string, ProviderInfo][]
  )
    .filter(
      ([, info]) =>
        !info.hidden &&
        (info.serviceKinds ?? ["llm"]).includes("llm") &&
        ms(info.name),
    )
    .sort(([ka, a], [kb, b]) => {
      const ca = gs(ka, "apikey").total > 0 ? 0 : 1;
      const cb = gs(kb, "apikey").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });

  const webCookieEntries = (
    Object.entries(WEB_COOKIE_PROVIDERS) as unknown as [string, ProviderInfo][]
  )
    .filter(([, info]) => !info.hidden && ms(info.name))
    .sort(([ka, a], [kb, b]) => {
      const ca = gs(ka, "cookie").total > 0 ? 0 : 1;
      const cb = gs(kb, "cookie").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });

  return {
    compatibleProviders,
    anthropicCompatibleProviders,
    oauthEntries,
    freeEntries,
    freeTierEntries,
    apikeyEntries,
    webCookieEntries,
  };
}

export function useProviderData(
  initialConnections: Connection[],
  initialNodes: ProviderNode[],
) {
  const [connections, setConnections] = useState<Connection[]>(initialConnections);
  const [providerNodes, setProviderNodes] = useState<ProviderNode[]>(initialNodes);
  const [showAllApikey, setShowAllApikey] = useState(false);
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] = useState(false);
  const [testingMode, setTestingMode] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResults | null>(null);
  const searchQuery = useHeaderSearchStore((s) => s.query);
  const registerSearch = useHeaderSearchStore((s) => s.register);
  const unregisterSearch = useHeaderSearchStore((s) => s.unregister);

  useEffect(() => {
    registerSearch(translate("Search providers...") || "Search providers...");
    return () => unregisterSearch();
  }, [registerSearch, unregisterSearch]);

  const { handleToggleProvider, handleBatchTest } = useProviderActions(
    connections, setConnections, testingMode, setTestingMode, setTestResults,
  );

  const getStats = (id: string, auth: string | string[]) =>
    getProviderStats(connections, id, auth, normalizeProviderId);

  const {
    compatibleProviders, anthropicCompatibleProviders,
    oauthEntries, freeEntries, freeTierEntries,
    apikeyEntries, webCookieEntries,
  } = computeEntries(providerNodes, searchQuery, connections);

  const isApikeySearching = !!searchQuery.trim();
  const visibleApikeyEntries =
    isApikeySearching || showAllApikey
      ? apikeyEntries
      : apikeyEntries.slice(0, APIKEY_INITIAL_VISIBLE);
  const hiddenApikeyCount = apikeyEntries.length - APIKEY_INITIAL_VISIBLE;

  const hasAnyResult =
    oauthEntries.length > 0 || freeEntries.length > 0 ||
    freeTierEntries.length > 0 || apikeyEntries.length > 0 ||
    webCookieEntries.length > 0 ||
    compatibleProviders.length > 0 || anthropicCompatibleProviders.length > 0;

  const filterEntries = (
    entries: [string, ProviderInfo][],
    source: "free" | "freeTier" | "other",
    authTypes: string | string[],
  ) => filterByAvailability(entries, source, authTypes, availabilityFilter, getStats);

  return {
    connections, setConnections,
    providerNodes, setProviderNodes,
    availabilityFilter, setAvailabilityFilter,
    showAllApikey, setShowAllApikey,
    showAddCompatibleModal, setShowAddCompatibleModal,
    showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal,
    testingMode, testResults, setTestResults,
    searchQuery,
    compatibleProviders, anthropicCompatibleProviders,
    oauthEntries, freeEntries, freeTierEntries,
    apikeyEntries, visibleApikeyEntries, hiddenApikeyCount,
    isApikeySearching, webCookieEntries, hasAnyResult,
    handleToggleProvider, handleBatchTest,
    getStats, availabilityFor, filterEntries,
  };
}
