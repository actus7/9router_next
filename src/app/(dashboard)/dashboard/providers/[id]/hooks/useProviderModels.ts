"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getModelKind, getModelsByProviderId } from "@/shared/constants/models";
import { getThinkingLevels } from "@/shared/llm-catalog";
import { translate } from "@/i18n/runtime";
import { useNotificationStore } from "@/store/notificationStore";
import { fetchSuggestedModels, type ModelsFetcher } from "@/shared/utils/providerModelsFetcher";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import type {
  Connection,
  CustomModelEntry,
  LiveModel,
  ModelDiagnostic,
  ProviderNode,
  SuggestedModel,
} from "../types";

const TEST_TIMEOUT_SCHEDULE = [15000, 25000, 40000];
export const CLEAR_ALL_MODELS_SENTINEL = "__catalog_cleared__";

function isDefinitivelyUnavailableModel(result: ModelDiagnostic): boolean {
  if (result.ok) return false;
  if (result.status === 404) return true;
  return /(?:model .*?(?:not found|does not exist|unsupported|not available)|unknown model)/i.test(result.error || "");
}

interface UseProviderModelsArgs {
  providerId: string;
  providerStorageAlias: string;
  providerAlias: string;
  isCompatible: boolean;
  isAnthropicCompatible: boolean;
  connections: Connection[];
  providerNode: ProviderNode | null;
  initialAliases: Record<string, string>;
  initialCustomModels: CustomModelEntry[];
  initialDisabledModels: Record<string, string[]>;
}

// Owns model aliases, custom models, disabled models, suggested/live model discovery,
// and model connectivity testing (single-model + "Test All Models" diagnostics).
export function useProviderModels({
  providerId,
  providerStorageAlias,
  providerAlias,
  isCompatible,
  isAnthropicCompatible,
  connections,
  providerNode,
  initialAliases,
  initialCustomModels,
  initialDisabledModels,
}: UseProviderModelsArgs) {
  const notify = useNotificationStore();

  const [modelAliases, setModelAliases] = useState<Record<string, string>>(initialAliases);
  const [customModels, setCustomModels] = useState<CustomModelEntry[]>(initialCustomModels);
  const [modelTestResults, setModelTestResults] = useState<Record<string, "ok" | "error">>({});
  const [modelsTestError, setModelsTestError] = useState<string>("");
  const [testingModelIds, setTestingModelIds] = useState<Set<string>>(() => new Set());
  const [testAllModels, setTestAllModels] = useState<{ running: boolean; results: ModelDiagnostic[] } | null>(null);
  const testAllAbortRef = useRef<AbortController | null>(null);
  const [showAddCustomModel, setShowAddCustomModel] = useState<boolean>(false);
  const [suggestedModels, setSuggestedModels] = useState<SuggestedModel[]>([]);
  const [liveModels, setLiveModels] = useState<LiveModel[]>([]);
  const [kiloFreeModels, setKiloFreeModels] = useState<LiveModel[]>([]);
  const [disabledModelIds, setDisabledModelIds] = useState<string[]>(initialDisabledModels[providerStorageAlias] || initialDisabledModels[providerAlias] || []);
  const [refreshingModels, setRefreshingModels] = useState<boolean>(false);
  const [importingQoderModels, setImportingQoderModels] = useState<boolean>(false);
  const [clearingModels, setClearingModels] = useState<boolean>(false);

  const staticModels = getModelsByProviderId(providerId) as LiveModel[];
  // A successful Refresh is a catalogue snapshot, not a temporary preview.
  // Rehydrate it from persisted discovered entries when returning to the page,
  // rather than falling back to a potentially stale built-in registry.
  const discoveredModels = Array.from(new Map(
    customModels
      .filter((model) => model.providerAlias === providerStorageAlias && model.source === "discovered" && (model.kind || model.type || "llm") === "llm")
      .map((model) => [model.id, { ...model, name: typeof model.name === "string" ? model.name : model.id } as LiveModel]),
  ).values());
  const catalogCleared = disabledModelIds.includes(CLEAR_ALL_MODELS_SENTINEL);
  const models = catalogCleared ? [] : (liveModels.length > 0 ? liveModels : (discoveredModels.length > 0 ? discoveredModels : staticModels));

  // Union of levels across this provider's reasoning models — drives the level picker options.
  // Include custom models too (e.g. manually added gpt-5.6-sol -> max).
  const providerThinkingLevels = (() => {
    const set = new Set<string>();
    const seen = new Set<string>();
    const addLevels = (modelId: string) => {
      if (!modelId || seen.has(modelId)) return;
      seen.add(modelId);
      const lv = getThinkingLevels(providerId, modelId);
      if (lv) lv.forEach((l: string) => { if (l !== "none") set.add(l); });
    };
    for (const m of models) addLevels(m.id);
    for (const m of kiloFreeModels) addLevels(m.id);
    for (const entry of customModels) {
      if (entry.providerAlias !== providerStorageAlias) continue;
      if ((entry.kind || entry.type || "llm") !== "llm") continue;
      addLevels(entry.id);
    }
    return set.size ? ["auto", ...[...set]] : null;
  })();


  const fetchDisabledModels = useCallback(async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDisabledModelIds(data.ids || []);
    } catch (error) {
      console.error("Error fetching disabled models:", error);
    }
  }, [providerStorageAlias]);

  const handleDisableModel = async (modelId: string) => {
    try {
      const res = await fetch("/api/models/disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, ids: [modelId] }),
      });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error disabling model:", error);
    }
  };

  const handleEnableModel = async (modelId: string) => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}&id=${encodeURIComponent(modelId)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error enabling model:", error);
    }
  };

  const handleDisableAll = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      const res = await fetch("/api/models/disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, ids }),
      });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error disabling all models:", error);
    }
  };

  const handleEnableAll = async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error enabling all models:", error);
    }
  };

  const handleClearProviderModels = async () => {
    if (clearingModels) return;
    setClearingModels(true);
    try {
      const providerCustomModels = customModels.filter(
        (model) => model.providerAlias === providerStorageAlias && (model.kind || model.type || "llm") === "llm",
      );
      const providerAliases = Object.entries(modelAliases)
        .filter(([, model]) => typeof model === "string" && model.startsWith(`${providerStorageAlias}/`))
        .map(([alias]) => alias);
      await Promise.all([
        ...providerCustomModels.map((model) =>
          fetch(`/api/models/custom?${new URLSearchParams({ providerAlias: providerStorageAlias, id: model.id, type: model.kind || model.type || "llm" })}`, { method: "DELETE" }),
        ),
        ...providerAliases.map((alias) => fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: "DELETE" })),
      ]);

      // "Clear" is destructive for this provider's model catalogue: remove
      // stale disabled records too. Keep only the invisible sentinel so the
      // curated static list does not immediately repopulate the cleared view.
      const clearDisabledResponse = await fetch(
        `/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`,
        { method: "DELETE" },
      );
      if (!clearDisabledResponse.ok) throw new Error("Failed to clear disabled models");

      const response = await fetch("/api/models/disabled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerAlias: providerStorageAlias, ids: [CLEAR_ALL_MODELS_SENTINEL] }),
      });
      if (!response.ok) throw new Error("Failed to clear models");

      setLiveModels([]);
      setSuggestedModels([]);
      setCustomModels((current) => current.filter((model) => model.providerAlias !== providerStorageAlias));
      setModelAliases((current) => Object.fromEntries(Object.entries(current).filter(([, model]) => !String(model).startsWith(`${providerStorageAlias}/`))));
      setDisabledModelIds([CLEAR_ALL_MODELS_SENTINEL]);
      setModelTestResults({});
      notify.success(translate("All models cleared. Refresh Models to load the current upstream catalog.") || "All models cleared. Refresh Models to load the current upstream catalog.");
    } catch (error) {
      console.error("Error clearing provider models:", error);
      notify.error(translate("Failed to clear models") || "Failed to clear models");
    } finally {
      setClearingModels(false);
    }
  };

  const fetchAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) {
        setModelAliases(data.aliases || {});
      }
    } catch (error) {
      console.error("Error fetching aliases:", error);
    }
  }, []);

  const fetchCustomModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models/custom", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setCustomModels(data.models || []);
      }
    } catch (error) {
      console.error("Error fetching custom models:", error);
    }
  }, []);

  // Fetch free models from Kilo API for kilocode provider
  useEffect(() => {
    if (providerId !== "kilocode") return;
    fetch("/api/providers/kilo/free-models")
      .then((res) => res.json())
      .then((data) => { if (data.models?.length) setKiloFreeModels(data.models); })
      .catch(() => {});
  }, [providerId]);

  // Cursor's model availability is account-specific and changes frequently.
  // Load the active account's live catalog for the dashboard; the static
  // registry remains the fallback while the request is pending or unavailable.
  useEffect(() => {
    if (providerId !== "cursor") {
      setLiveModels([]);
      return;
    }

    const connection = connections.find((item) => item.isActive !== false);
    if (!connection?.id) {
      setLiveModels([]);
      return;
    }

    let cancelled = false;
    fetch(`/api/providers/${connection.id}/models`, { cache: "no-store" })
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (!cancelled && ok && Array.isArray(data.models) && data.models.length > 0) {
          setLiveModels(data.models);
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [providerId, connections]);

  // Fetch suggested models from provider's public API (if configured).
  // Providers with no static catalog (models: [] in the registry) rely entirely
  // on this live fetch, so also populate the main `models` list (via
  // liveModels) here — otherwise the page would show nothing until the user
  // manually clicks "Refresh Models".
  useEffect(() => {
    if (catalogCleared) {
      setSuggestedModels([]);
      return;
    }
    const fetcher = AI_PROVIDERS[providerId]?.modelsFetcher as ModelsFetcher | undefined;
    if (!fetcher) return;
    const hasNoStaticCatalog = staticModels.length === 0;
    fetchSuggestedModels(fetcher).then((result) => {
      setSuggestedModels(result);
      if (hasNoStaticCatalog) setLiveModels(result as LiveModel[]);
    });
  }, [providerId, catalogCleared]);

  const handleDeleteAlias = async (alias: string) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchAliases();
      }
    } catch (error) {
      console.error("Error deleting alias:", error);
    }
  };


  const handleAddCustomModel = async (
    modelId: string,
    type: string = "llm",
    providerAliasOverride: string = providerStorageAlias,
    source: "manual" | "discovered" = "manual",
    modelData?: Record<string, unknown>,
  ) => {
    try {
      const res = await fetch("/api/models/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerAlias: providerAliasOverride,
          id: modelId,
          type,
          source,
          name: typeof modelData?.name === "string" ? modelData.name : modelId,
          metadata: modelData,
        }),
      });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
      } else {
        const data = await res.json();
        notify.error(data.error || "Failed to add custom model");
      }
    } catch (error) {
      console.error("Error adding custom model:", error);
    }
  };

  const handleDeleteCustomModel = async (modelId: string, type: string = "llm", providerAliasOverride: string = providerStorageAlias) => {
    try {
      const params = new URLSearchParams({ providerAlias: providerAliasOverride, id: modelId, type });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (error) {
      console.error("Error deleting custom model:", error);
    }
  };

  // Fetch Qoder model list and automatically add to available models
  const handleImportQoderModels = async () => {
    if (importingQoderModels) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) {
      notify.error(translate("Please add an active Qoder connection first") || "");
      return;
    }

    setImportingQoderModels(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        notify.error(data.error || translate("Failed to fetch models"));
        return;
      }
      const fetchedModels = data.models || [];
      if (fetchedModels.length === 0) {
        notify.warning(translate("No models returned") || "");
        return;
      }

      let importedCount = 0;
      for (const model of fetchedModels) {
        const modelId = model.id || model.name;
        if (!modelId) continue;

        // Qoder model ID format may be "qoder/auto" or "auto", need to remove prefix
        const cleanModelId = modelId.replace(/^qoder\//, "");
        const alreadyExists = customModels.some(
          (entry) => entry.providerAlias === providerStorageAlias && entry.id === cleanModelId && (entry.kind || entry.type || "llm") === "llm"
        ) || Object.values(modelAliases).includes(`${providerStorageAlias}/${cleanModelId}`);
        if (alreadyExists) {
          continue;
        }

        await handleAddCustomModel(cleanModelId, "llm", providerStorageAlias);
        importedCount += 1;
      }

      if (importedCount === 0) {
        notify.warning(translate("All models already exist, no new models added") || "");
      } else {
        notify.success(translate("Successfully added") + ` ${importedCount} ` + translate("models"));
      }
    } catch (error: unknown) {
      console.error("Error importing Qoder models:", error);
      notify.error(translate("Error fetching models") + ": " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setImportingQoderModels(false);
    }
  };


  const handleRefreshModels = async () => {
    if (refreshingModels) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);

    setRefreshingModels(true);
    try {
      let fetched: Array<{ id?: string; name?: string; kind?: string; type?: string }> = [];

      if (activeConnection) {
        // Use connection endpoint (has credentials)
        const res = await fetch(`/api/providers/${activeConnection.id}/models`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) {
          notify.error(data.error || translate("Failed to fetch models"));
          return;
        }
        fetched = data.models || [];
      } else if (isCompatible && providerNode?.baseUrl) {
        // Compatible provider without connection — fetch directly from base URL
        const baseUrl = (providerNode.baseUrl as string).replace(/\/$/, "");
        const modelsUrl = isAnthropicCompatible ? `${baseUrl}/models` : `${baseUrl}/models`;
        const res = await fetch(modelsUrl, { cache: "no-store" });
        if (!res.ok) {
          notify.error(translate("Failed to fetch models") + ` (${res.status})`);
          return;
        }
        const data = await res.json();
        fetched = data.data || data.models || [];
      } else {
        // No connection and not a custom compatible node — try the provider's public models API (free/no-auth providers)
        const fetcher = AI_PROVIDERS[providerId]?.modelsFetcher as { url: string; type: string } | undefined;
        if (fetcher) {
          fetched = await fetchSuggestedModels(fetcher);
        } else {
          // No live discovery endpoint for this provider — re-sync to the curated static catalog.
          fetched = getModelsByProviderId(providerId);
          if (fetched.length === 0) {
            notify.error(translate("No active connection available") || "");
            return;
          }
        }
      }

      if (fetched.length === 0) {
        notify.warning(translate("No models returned") || "");
        return;
      }

      const fetchedIds = new Set(
        fetched
          .map((model) => model.id || model.name)
          .filter((modelId): modelId is string => typeof modelId === "string" && modelId.length > 0),
      );
      // Only LLMs belong in the gateway's chat-model custom catalog. Ark's live
      // list also contains embeddings, image, and video models; persisting them
      // as LLMs makes later chat probes call the wrong endpoint.
      const fetchedLlmModels = fetched.filter((model) =>
        !!(model.id || model.name) && (getModelKind(model) || "llm") === "llm",
      );
      // Refresh is the explicit rebuild action: models returned by the current
      // upstream catalogue become selectable again after a deliberate clear.
      const restoredIds = [...fetchedIds, CLEAR_ALL_MODELS_SENTINEL];
      if (restoredIds.length > 0) {
        const restoreResponse = await fetch("/api/models/disabled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerAlias: providerStorageAlias, ids: restoredIds, action: "enable" }),
        });
        if (restoreResponse.ok) await fetchDisabledModels();
      }

      // Persist the complete upstream LLM catalogue in one request. The API
      // transaction removes only stale discovered entries and preserves manual
      // models, so a large OpenRouter refresh cannot turn into thousands of
      // browser-to-server requests.
      const syncResponse = await fetch("/api/models/discovered", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, models: fetchedLlmModels }),
      });
      const syncData = await syncResponse.json();
      if (!syncResponse.ok) {
        notify.error(syncData.error || "Failed to synchronize models");
        return;
      }
      if (Array.isArray(syncData.models)) {
        setCustomModels(syncData.models);
      }
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));

      setLiveModels(fetched as LiveModel[]);
      notify.success(`Atualizado: ${fetched.length} modelos`);
    } catch (error: unknown) {
      console.error("Error refreshing models:", error);
      notify.error(translate("Error fetching models") + ": " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setRefreshingModels(false);
    }
  };


  // Ping one model, retrying only on timeout (not on definitive errors like 401/404),
  // with an increasing timeout per attempt.
  const pingModelWithRetry = async (
    modelId: string,
    onProgress: (diagnostic: ModelDiagnostic) => void,
    timeoutSchedule: readonly number[] = TEST_TIMEOUT_SCHEDULE,
    signal?: AbortSignal,
  ): Promise<ModelDiagnostic> => {
    let lastError = translate("Model is not reachable") || "Model is not reachable";
    let attemptsMade = 0;
    let lastStatus: number | undefined;
    for (let attempt = 0; attempt < timeoutSchedule.length; attempt++) {
      if (signal?.aborted) return { modelId, ok: false, state: "cancelled", error: "Test cancelled", attempts: attemptsMade, status: lastStatus };
      attemptsMade = attempt + 1;
      onProgress({ modelId, ok: false, state: attempt === 0 ? "testing" : "retrying", attempts: attemptsMade });
      try {
        const res = await fetch("/api/models/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}`, timeoutMs: timeoutSchedule[attempt] }),
          signal,
        });
        const data = await res.json();
        if (data.ok) return { modelId, ok: true, state: "passed", attempts: attemptsMade, latencyMs: data.latencyMs, status: data.status };
        lastError = data.error || lastError;
        lastStatus = data.status;
        if (data.isTimeout) {
          onProgress({ modelId, ok: false, state: "retrying", attempts: attemptsMade, status: lastStatus, error: lastError });
        }
        if (data.status === 429 || Number(data.status) >= 500) {
          onProgress({ modelId, ok: false, state: "retrying", attempts: attemptsMade, status: lastStatus, error: lastError });
          continue;
        }
        if (!data.isTimeout) break; // definitive failure — no point retrying
      } catch {
        if (signal?.aborted) return { modelId, ok: false, state: "cancelled", error: "Test cancelled", attempts: attemptsMade, status: lastStatus };
        lastError = translate("Network error") || "Network error";
        onProgress({ modelId, ok: false, state: "retrying", attempts: attemptsMade, error: lastError });
      }
    }
    return { modelId, ok: false, state: "failed", error: lastError, attempts: attemptsMade, status: lastStatus };
  };

  // Test every currently-displayed model concurrently, each with its own retry
  // schedule, and stream results into the diagnostics modal as they land.
  const handleTestAllModels = async () => {
    if (testAllAbortRef.current) return;
    const allModels = [
      ...models,
      ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
    ].filter((m) => { const k = getModelKind(m); return !k || k === "llm"; });
    const disabledSet = new Set(disabledModelIds);
    const modelIds = [...new Set(
      allModels
        .map((model) => model.id)
        .filter((modelId): modelId is string => typeof modelId === "string" && modelId.trim().length > 0)
        .filter((modelId) => !disabledSet.has(modelId)),
    )];
    if (modelIds.length === 0) return;

    setTestAllModels({
      running: true,
      results: modelIds.map((modelId) => ({ modelId, ok: false, state: "queued", attempts: 0 })),
    });
    const controller = new AbortController();
    testAllAbortRef.current = controller;
    // Keep provider tests useful instead of turning a large catalogue into a
    // burst that trips rate limits or exhausts every connection at once.
    // Ollama Cloud explicitly permits one cloud model at a time. Parallel
    // probes compete for that single slot and turn valid models into timeout
    // failures; keep other providers at the existing three-worker limit.
    const maxConcurrentTests = providerId === "ollama" ? 1 : 3;
    // Match the manual test exactly for Ollama Cloud: one 25s request. The
    // cloud account admits only one model at a time, so retry waves only make
    // an accurate serial test needlessly slower.
    const timeoutSchedule = providerId === "ollama" ? [25000] : TEST_TIMEOUT_SCHEDULE;
    const results: ModelDiagnostic[] = [];
    let nextIndex = 0;
    const runNext = async () => {
      while (nextIndex < modelIds.length) {
        if (controller.signal.aborted) return;
        const modelId = modelIds[nextIndex++];
        const updateProgress = (diagnostic: ModelDiagnostic) => {
          setTestAllModels((current) => current
            ? { ...current, results: current.results.map((item) => item.modelId === modelId ? diagnostic : item) }
            : current);
        };
      const result = await pingModelWithRetry(modelId, updateProgress, timeoutSchedule, controller.signal);
      if (result.state !== "cancelled") setModelTestResults((prev) => ({ ...prev, [modelId]: result.ok ? "ok" : "error" }));
      updateProgress(result);
        results.push(result);
      }
    };
    await Promise.all(Array.from({ length: Math.min(maxConcurrentTests, modelIds.length) }, runNext));

    const unavailableIds = controller.signal.aborted ? [] : results.filter(isDefinitivelyUnavailableModel).map((result) => result.modelId);
    if (unavailableIds.length > 0) {
      try {
        const response = await fetch("/api/models/disabled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerAlias: providerStorageAlias, ids: unavailableIds }),
        });
        if (response.ok) {
          setDisabledModelIds((current) => [...new Set([...current, ...unavailableIds])]);
          notify.warning(`${unavailableIds.length} ${translate("model(s) no longer available upstream â€” moved to Disabled")}`);
        }
      } catch (error) {
        console.error("Error disabling definitively unavailable models:", error);
      }
    }
    setTestAllModels((prev) => prev ? { ...prev, running: false } : prev);
    testAllAbortRef.current = null;
  };

  const handleCancelTestAllModels = () => {
    const controller = testAllAbortRef.current;
    if (!controller) return;
    controller.abort();
    setTestAllModels((current) => current ? {
      running: false,
      results: current.results.map((result) => (
        result.state === "queued" || result.state === "testing" || result.state === "retrying"
          ? { ...result, state: "cancelled", error: "Test cancelled" }
          : result
      )),
    } : current);
  };

  const handleTestModel = async (modelId: string) => {
    if (testingModelIds.has(modelId)) return;
    setTestingModelIds((prev) => new Set(prev).add(modelId));
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setModelsTestError(data.ok ? "" : (data.error || translate("Model is not reachable")));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setModelsTestError(translate("Network error") || "Network error");
    } finally {
      setTestingModelIds((prev) => { const n = new Set(prev); n.delete(modelId); return n; });
    }
  };

  return {
    modelAliases,
    customModels,
    modelTestResults,
    modelsTestError,
    testingModelIds,
    testAllModels,
    setTestAllModels,
    showAddCustomModel,
    setShowAddCustomModel,
    suggestedModels,
    liveModels,
    kiloFreeModels,
    disabledModelIds,
    refreshingModels,
    importingQoderModels,
    clearingModels,
    staticModels,
    models,
    providerThinkingLevels,
    fetchDisabledModels,
    handleDisableModel,
    handleEnableModel,
    handleDisableAll,
    handleEnableAll,
    handleClearProviderModels,
    fetchAliases,
    fetchCustomModels,
    handleDeleteAlias,
    handleAddCustomModel,
    handleDeleteCustomModel,
    handleImportQoderModels,
    handleRefreshModels,
    handleTestAllModels,
    handleCancelTestAllModels,
    handleTestModel,
  };
}

export type UseProviderModelsReturn = ReturnType<typeof useProviderModels>;
