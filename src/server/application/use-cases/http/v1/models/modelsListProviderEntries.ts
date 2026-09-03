import { AI_PROVIDERS } from "@/shared/constants/providers";
import { capabilitiesFromServiceKind, getCapabilitiesForModel } from "@/server/llm-gateway/catalog";
import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import {
  LLM_KIND,
  inferKindFromUnknownModelId,
  type ProviderContext,
} from "./modelsListTypes";

/** Build final model entries (with capabilities) and web search/fetch entries. */
export function buildProviderModelEntries(
  ctx: ProviderContext,
  mergedModelIds: string[],
  customModelKindById: Map<string, string>,
  kindFilter: string[],
  isDisabled: (alias: string, modelId: string) => boolean,
): Record<string, unknown>[] {
  const { outputAlias, staticAlias, providerId, staticModelKindById, liveModelKindById, liveCapabilitiesById } = ctx;
  const entries: Record<string, unknown>[] = [];

  for (const modelId of mergedModelIds) {
    // Resolve kind: prefer custom/live metadata, then static, then ID heuristics.
    const customKind = customModelKindById.get(modelId);
    const liveKind = liveModelKindById.get(modelId);
    const kind = customKind || liveKind || staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
    // imageToText custom models stay in the LLM list (vision-capable chat models)
    const allowAsLlm = kind === "imageToText" && kindFilter.includes(LLM_KIND);
    if (!kindFilter.includes(kind) && !allowAsLlm) continue;
    if (isDisabled(outputAlias, modelId) || isDisabled(staticAlias, modelId)) continue;

    const model: Record<string, unknown> = {
      id: `${outputAlias}/${modelId}`,
      object: "model",
      owned_by: outputAlias,
    };
    // Live-catalog resolvers (kiro/qoder/github/clinepass) mostly only return
    // { id, name } — no per-model capability data. Fall back to the same
    // pattern-matched capabilities the dashboard uses (useModelCaps.js) so
    // dynamically-discovered LLM models still surface vision/reasoning/search/tools.
    const caps: Record<string, unknown> | null = liveCapabilitiesById.get(modelId)
      || capabilitiesFromServiceKind((customKind || liveKind) as string)
      || (kind === LLM_KIND ? getCapabilitiesForModel(providerId, modelId) : null);
    if (caps) model.capabilities = caps;
    // Token limits under the snake_case names the OpenAI/OpenRouter
    // convention uses. `capabilities.contextWindow` is camelCase and nested,
    // so clients matching context_length find nothing, fall back to guessing
    // the window from the model name, and guess high — a 372k model read as
    // 1.05M never reaches its compaction threshold and hard-fails upstream.
    // Emitted at top level because not every client recurses into nested
    // objects; the camelCase `capabilities` block stays for compatibility.
    if (kind === LLM_KIND || allowAsLlm) {
      let contextWindow = caps?.contextWindow as number | undefined;
      let maxOutput = caps?.maxOutput as number | undefined;
      // Live-catalog and service-kind capabilities are usually partial
      // (often just { tools: true }), so fill the gaps from the static
      // table rather than emitting null and leaving clients to guess.
      if (!Number.isFinite(contextWindow) || !Number.isFinite(maxOutput)) {
        const fallback = getCapabilitiesForModel(providerId, modelId);
        if (!Number.isFinite(contextWindow)) contextWindow = fallback.contextWindow;
        if (!Number.isFinite(maxOutput)) maxOutput = fallback.maxOutput;
      }
      if (Number.isFinite(contextWindow)) model.context_length = contextWindow;
      if (Number.isFinite(maxOutput)) model.max_completion_tokens = maxOutput;
    }
    entries.push(model);
  }

  // Web search/fetch — provider IS the model, expose as {alias}/search and/or {alias}/fetch with explicit kind
  const providerInfo = AI_PROVIDERS[providerId];
  if (kindFilter.includes("webSearch") && (providerInfo?.searchConfig || providerInfo?.searchViaChat)) {
    entries.push({
      id: `${outputAlias}/search`,
      object: "model",
      kind: "webSearch",
      owned_by: outputAlias,
    });
  }
  if (kindFilter.includes("webFetch") && providerInfo?.fetchConfig) {
    entries.push({
      id: `${outputAlias}/fetch`,
      object: "model",
      kind: "webFetch",
      owned_by: outputAlias,
    });
  }

  return entries;
}

/** Remove duplicate models by id, preserving first occurrence order. */
export function deduplicateModels(models: Record<string, unknown>[]): Record<string, unknown>[] {
  const deduped: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    if (!model?.id || seen.has(model.id as string)) continue;
    seen.add(model.id as string);
    deduped.push(model);
  }
  return deduped;
}

/** Build web search/fetch entries for noAuth providers without an active connection. */
export function buildNoAuthWebEntries(
  kindFilter: string[],
  connectedProviders: Set<string>,
): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  for (const [providerId, providerInfo] of Object.entries(AI_PROVIDERS)) {
    if (!providerInfo.noAuth) continue;
    if (connectedProviders.has(providerId)) continue;
    if (providerInfo.hidden) continue;
    const hiddenKinds = providerInfo.hiddenKinds as string[] | undefined;

    const alias = (PROVIDER_ID_TO_ALIAS[providerId] || providerInfo.alias || providerId) as string;

    if (kindFilter.includes("webSearch") && (providerInfo.searchConfig || providerInfo.searchViaChat)) {
      if (!hiddenKinds?.includes("webSearch")) {
        entries.push({
          id: `${alias}/search`,
          object: "model",
          kind: "webSearch",
          owned_by: alias,
        });
      }
    }
    if (kindFilter.includes("webFetch") && providerInfo.fetchConfig) {
      if (!hiddenKinds?.includes("webFetch")) {
        entries.push({
          id: `${alias}/fetch`,
          object: "model",
          kind: "webFetch",
          owned_by: alias,
        });
      }
    }
  }
  return entries;
}
