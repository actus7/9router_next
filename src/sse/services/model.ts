// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "@/lib/open-sse/services/model";
import REGISTRY from "@/lib/open-sse/providers/registry/index";

interface ParsedModel {
  provider?: string | null;
  providerAlias?: string;
  model: string;
  isAlias?: boolean;
}

interface ModelInfo {
  provider: string | null;
  model: string;
}

interface ProviderNode {
  id: string;
  prefix: string;
  type: string;
}

interface Combo {
  models: string[];
  [key: string]: unknown;
}

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES: Record<string, string> = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES: Set<string> = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY as Array<{ id: string; alias?: string; aliases?: string[] }>) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

export function parseModel(modelStr: string): ParsedModel {
  const parsed: ParsedModel = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias: string): Promise<string | null> {
  const aliases: Record<string, string> = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr: string): Promise<ModelInfo> {
  const parsed: ParsedModel = parseModel(modelStr);

  if (!parsed.isAlias) {
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias!)) {
      const openaiNodes: ProviderNode[] = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI: ProviderNode | undefined = openaiNodes.find((node: ProviderNode) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      const anthropicNodes: ProviderNode[] = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic: ProviderNode | undefined = anthropicNodes.find((node: ProviderNode) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }

      const embeddingNodes: ProviderNode[] = await getProviderNodes({ type: "custom-embedding" });
      const matchedEmbedding: ProviderNode | undefined = embeddingNodes.find((node: ProviderNode) => node.prefix === parsed.providerAlias);
      if (matchedEmbedding) {
        return { provider: matchedEmbedding.id, model: parsed.model };
      }
    }
    return {
      provider: parsed.provider ?? null,
      model: parsed.model
    };
  }

  const combo: Combo | null = await getComboByName(parsed.model);
  if (combo) {
    return { provider: null, model: parsed.model };
  }

  return getModelInfoCore(modelStr, getModelAliases);
}

/**
 * Check if model is a combo and get models list
 * @returns Array of models or null if not a combo
 */
export async function getComboModels(modelStr: string): Promise<string[] | null> {
  if (modelStr.includes("/")) return null;

  const combo: Combo | null = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
