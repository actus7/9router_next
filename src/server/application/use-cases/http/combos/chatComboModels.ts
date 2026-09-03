// A chat combo (kind null, "llm" or "smart") is answered by /v1/chat/completions,
// so every model in it must come from a provider that can hold a conversation.
// Search-only providers list models with no `kind`, which used to let them into
// chat combos and reply with a raw result list instead of an answer.

import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";

const CHAT_COMBO_KINDS = new Set(["llm", "smart"]);
const LLM_KIND = "llm";

export function isChatComboKind(kind: unknown): boolean {
  if (kind === null || kind === undefined || kind === "") return true;
  return typeof kind === "string" && CHAT_COMBO_KINDS.has(kind);
}

function providerAnswersChat(modelKey: string): boolean {
  const separator = modelKey.indexOf("/");
  if (separator <= 0) return true;
  const provider = AI_PROVIDERS[resolveProviderId(modelKey.slice(0, separator))];
  // Unknown providers (custom nodes, user prefixes) are left alone: the catalog
  // cannot vouch for them either way, and guessing would block valid combos.
  if (!provider) return true;
  const kinds = Array.isArray(provider.serviceKinds) && provider.serviceKinds.length > 0
    ? provider.serviceKinds
    : [LLM_KIND];
  return kinds.includes(LLM_KIND);
}

function collectRoutingModels(routing: unknown): string[] {
  if (!routing || typeof routing !== "object" || Array.isArray(routing)) return [];
  const overrides = (routing as Record<string, unknown>).overrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return [];
  const collected: string[] = [];
  for (const perNeed of Object.values(overrides as Record<string, unknown>)) {
    if (!perNeed || typeof perNeed !== "object" || Array.isArray(perNeed)) continue;
    for (const perTier of Object.values(perNeed as Record<string, unknown>)) {
      if (!Array.isArray(perTier)) continue;
      for (const model of perTier) if (typeof model === "string") collected.push(model);
    }
  }
  return collected;
}

export function findNonChatModels(models: unknown, routing?: unknown): string[] {
  const listed = Array.isArray(models) ? models.filter((model): model is string => typeof model === "string") : [];
  const candidates = [...new Set([...listed, ...collectRoutingModels(routing)])];
  return candidates.filter((model) => !providerAnswersChat(model));
}

/** Human-readable rejection for a chat combo carrying non-chat models, or null when it is fine. */
export function chatComboModelsError(kind: unknown, models: unknown, routing?: unknown): string | null {
  if (!isChatComboKind(kind)) return null;
  const offenders = findNonChatModels(models, routing);
  if (offenders.length === 0) return null;
  return `These models cannot answer chat requests and must be removed: ${offenders.join(", ")}. `
    + "Their providers only offer other services (such as web search or speech).";
}
