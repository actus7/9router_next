import { APP_CONFIG } from "@/shared/constants/config";
import type { NormalizedModel, ProviderGroup } from "./types";

export const COMBO_PROVIDER_ID = "modelhub";

// Combos routed by the chat: a combo without `kind` is an LLM combo, and a
// smart one resolves to an LLM at request time. Media/web combos (image, tts,
// stt, webSearch, webFetch, video) belong to other endpoints.
const CHAT_COMBO_KINDS = new Set(["llm", "smart"]);

export interface ComboPayload {
  name?: unknown;
  kind?: unknown;
  models?: unknown;
}

function comboName(combo: ComboPayload): string {
  return typeof combo.name === "string" ? combo.name.trim() : "";
}

function comboKind(combo: ComboPayload): string {
  return typeof combo.kind === "string" ? combo.kind.trim().toLowerCase() : "";
}

export function isChatCombo(combo: ComboPayload): boolean {
  // The gateway only looks a combo up when the requested model has no "/", so a
  // name containing one could never be routed back to this combo.
  const name = comboName(combo);
  if (!name || name.includes("/")) return false;

  const kind = comboKind(combo);
  if (kind && !CHAT_COMBO_KINDS.has(kind)) return false;

  // A smart combo picks from the active inventory on each request; a classic one
  // can only route to the models it was given, so an empty list is unroutable.
  if (kind === "smart") return true;
  return Array.isArray(combo.models)
    && combo.models.some((model) => typeof model === "string" && model.trim().length > 0);
}

// Combos are virtual models: they have no provider connection, and the request
// model must stay the bare combo name (`chat`, not `modelhub/chat`) for
// `getComboModels` to resolve it. They're grouped under the app's own name so
// the picker shows locally composed routes next to real providers.
export function toComboProviderGroup(combos: ComboPayload[]): ProviderGroup | null {
  const models: NormalizedModel[] = combos.filter(isChatCombo).map((combo) => {
    const name = comboName(combo);
    return {
      id: name,
      requestModel: name,
      name,
      providerId: COMBO_PROVIDER_ID,
      providerName: APP_CONFIG.name,
      source: "combo",
      ...(comboKind(combo) === "smart" ? { kind: "smart" } : {}),
    };
  });

  if (models.length === 0) return null;
  return {
    providerId: COMBO_PROVIDER_ID,
    providerName: APP_CONFIG.name,
    providerType: "combo",
    connections: [],
    models,
  };
}

export function parseComboGroups(payload: Record<string, unknown>): ProviderGroup[] {
  if (!Array.isArray(payload?.combos)) return [];
  const group = toComboProviderGroup(payload.combos as ComboPayload[]);
  return group ? [group] : [];
}
