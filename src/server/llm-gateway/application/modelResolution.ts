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

function parseModel(modelStr: string): ParsedModel {
  const parsed = parseModelCore(modelStr) as unknown as ParsedModel;
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
async function resolveModelAlias(alias: string): Promise<string | null> {
  const aliases = await getModelAliases() as Record<string, string>;
  return resolveModelAliasFromMap(alias, aliases) as unknown as string | null;
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr: string): Promise<ModelInfo> {
  const parsed: ParsedModel = parseModel(modelStr);

  if (!parsed.isAlias) {
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias!)) {
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" }) as unknown as ProviderNode[];
      const matchedOpenAI: ProviderNode | undefined = openaiNodes.find((node: ProviderNode) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" }) as unknown as ProviderNode[];
      const matchedAnthropic: ProviderNode | undefined = anthropicNodes.find((node: ProviderNode) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }

      const embeddingNodes = await getProviderNodes({ type: "custom-embedding" }) as unknown as ProviderNode[];
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

  const combo = await getComboByName(parsed.model) as unknown as Combo | null;
  if (combo) {
    return { provider: null, model: parsed.model };
  }

  return getModelInfoCore(modelStr, getModelAliases as unknown as Parameters<typeof getModelInfoCore>[1]) as unknown as ModelInfo;
}

/**
 * Check if model is a combo and get models list
 * @returns Array of models or null if not a combo
 */
export async function getComboModels(modelStr: string): Promise<string[] | null> {
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr) as unknown as Combo | null;
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
