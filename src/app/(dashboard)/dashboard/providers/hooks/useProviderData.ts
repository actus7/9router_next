"use client";

import { useState, useEffect } from "react";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { translate } from "@/i18n/runtime";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { getProviderStats, availabilityFor, filterByAvailability } from "../utils/providerHelpers";
import { useProviderActions } from "./useProviderActions";
import { computeCompatibleProviders, computeProviderEntries } from "./computeProviderEntries";
import type { Connection, ProviderNode, ProviderInfo, AvailabilityFilter, TestResults } from "../types";
import { getTypesafeProviderStats, TYPESAFE_PROVIDER } from "../typesafeProvider";

const APIKEY_INITIAL_VISIBLE = 20;
const FREE_AUTH_TYPES = ["oauth", "apikey", "api_key"];

export function useProviderData(
  initialConnections: Connection[],
  initialNodes: ProviderNode[],
  hasTypesafeKey: boolean | null = null,
) {
  const [connections, setConnections] = useState<Connection[]>(initialConnections);
  const [providerNodes, setProviderNodes] = useState<ProviderNode[]>(initialNodes);
  const [showAllApikey, setShowAllApikey] = useState(false);
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [kindFilter, setKindFilter] = useState<string[]>([]);
  const toggleKind = (kind: string) => setKindFilter((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
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

  const { handleToggleProvider, handleBatchTest } = useProviderActions(connections, setConnections, testingMode, setTestingMode, setTestResults);

  const getStats = (id: string, auth: string | string[]) => id === TYPESAFE_PROVIDER.id
    ? getTypesafeProviderStats(hasTypesafeKey)
    : getProviderStats(connections, id, auth, normalizeProviderId);

  // Custom endpoints are chat-only: a media chip without "llm" hides them.
  const showCustom = kindFilter.length === 0 || kindFilter.includes("llm");
  const { compatibleProviders, anthropicCompatibleProviders } = computeCompatibleProviders(showCustom ? providerNodes : [], searchQuery);
  const { oauthEntries, freeEntries, freeTierEntries, apikeyEntries, webCookieEntries, retiredEntries } = computeProviderEntries(searchQuery, connections, kindFilter, hasTypesafeKey);

  const isApikeySearching = !!searchQuery.trim();
  const visibleApikeyEntries = isApikeySearching || showAllApikey ? apikeyEntries : apikeyEntries.slice(0, APIKEY_INITIAL_VISIBLE);
  const hiddenApikeyCount = apikeyEntries.length - APIKEY_INITIAL_VISIBLE;

  const filterEntries = (entries: [string, ProviderInfo][], source: "free" | "freeTier" | "other", authTypes: string | string[]) =>
    filterByAvailability(entries, source, authTypes, availabilityFilter, getStats);

  const oauthVisible = filterEntries(oauthEntries, "other", "oauth");
  const freeVisible = filterEntries(freeEntries, "free", FREE_AUTH_TYPES);
  const freeTierVisible = filterEntries(freeTierEntries, "freeTier", FREE_AUTH_TYPES);
  const apikeyVisible = filterEntries(apikeyEntries, "other", "apikey");

  const hasAnyResult = oauthVisible.length > 0 || freeVisible.length > 0 || freeTierVisible.length > 0 || apikeyVisible.length > 0 || compatibleProviders.length > 0 || anthropicCompatibleProviders.length > 0 || retiredEntries.length > 0;

  return {
    connections, setConnections, providerNodes, setProviderNodes,
    availabilityFilter, setAvailabilityFilter, kindFilter, setKindFilter, toggleKind, showCustom, showAllApikey, setShowAllApikey,
    showAddCompatibleModal, setShowAddCompatibleModal,
    showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal,
    testingMode, testResults, setTestResults, searchQuery,
    compatibleProviders, anthropicCompatibleProviders,
    oauthEntries, freeEntries, freeTierEntries,
    apikeyEntries, visibleApikeyEntries, hiddenApikeyCount,
    isApikeySearching, webCookieEntries, retiredEntries, hasAnyResult,
    handleToggleProvider, handleBatchTest,
    getStats, availabilityFor, filterEntries,
    oauthVisible, freeVisible, freeTierVisible, apikeyVisible,
  };
}
