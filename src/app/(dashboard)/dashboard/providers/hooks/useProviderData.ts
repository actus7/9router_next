"use client";

import { useState, useEffect } from "react";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { translate } from "@/i18n/runtime";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { getProviderStats, availabilityFor, filterByAvailability } from "../utils/providerHelpers";
import { useProviderActions } from "./useProviderActions";
import { computeCompatibleProviders, computeProviderEntries } from "./computeProviderEntries";
import type { Connection, ProviderNode, ProviderInfo, AvailabilityFilter, TestResults } from "../types";

const APIKEY_INITIAL_VISIBLE = 20;

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

  const { handleToggleProvider, handleBatchTest } = useProviderActions(connections, setConnections, testingMode, setTestingMode, setTestResults);

  const getStats = (id: string, auth: string | string[]) => getProviderStats(connections, id, auth, normalizeProviderId);

  const { compatibleProviders, anthropicCompatibleProviders } = computeCompatibleProviders(providerNodes, searchQuery);
  const { oauthEntries, freeEntries, freeTierEntries, apikeyEntries, webCookieEntries } = computeProviderEntries(searchQuery, connections);

  const isApikeySearching = !!searchQuery.trim();
  const visibleApikeyEntries = isApikeySearching || showAllApikey ? apikeyEntries : apikeyEntries.slice(0, APIKEY_INITIAL_VISIBLE);
  const hiddenApikeyCount = apikeyEntries.length - APIKEY_INITIAL_VISIBLE;

  const hasAnyResult = oauthEntries.length > 0 || freeEntries.length > 0 || freeTierEntries.length > 0 || apikeyEntries.length > 0 || webCookieEntries.length > 0 || compatibleProviders.length > 0 || anthropicCompatibleProviders.length > 0;

  const filterEntries = (entries: [string, ProviderInfo][], source: "free" | "freeTier" | "other", authTypes: string | string[]) =>
    filterByAvailability(entries, source, authTypes, availabilityFilter, getStats);

  return {
    connections, setConnections, providerNodes, setProviderNodes,
    availabilityFilter, setAvailabilityFilter, showAllApikey, setShowAllApikey,
    showAddCompatibleModal, setShowAddCompatibleModal,
    showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal,
    testingMode, testResults, setTestResults, searchQuery,
    compatibleProviders, anthropicCompatibleProviders,
    oauthEntries, freeEntries, freeTierEntries,
    apikeyEntries, visibleApikeyEntries, hiddenApikeyCount,
    isApikeySearching, webCookieEntries, hasAnyResult,
    handleToggleProvider, handleBatchTest,
    getStats, availabilityFor, filterEntries,
  };
}
