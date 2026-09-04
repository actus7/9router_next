export {
  PROVIDER_MODELS,
  PROVIDER_ID_TO_ALIAS,
  getModelsByProviderId,
} from "@/shared/llm-catalog";

import { AI_PROVIDERS } from "./providers";
import { PROVIDER_MODELS as MODELS } from "@/shared/llm-catalog";

// Providers that accept any model (passthrough)
void (new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]) => p.passthroughModels)
    .map(([key]) => key)
));

// Wrap isValidModel with passthrough providers

// Legacy AI_MODELS for backward compatibility
export const AI_MODELS = Object.entries(MODELS as Record<string, { id: string; name: string }[]>).flatMap(([alias, models]) =>
  models.map((m) => ({ provider: alias, model: m.id, name: m.name }))
);

const KIND_PATTERNS: Array<[string, RegExp]> = [
  ["embedding", /(?:^|[-_/])(?:embed|embedding)(?:[-_/]|$)/i],
  ["stt", /(?:^|[-_/])(?:whisper|transcri(?:be|ption)|stt|asr)(?:[-_/]|$)/i],
  ["tts", /(?:^|[-_/])(?:tts|eleven|speech)(?:[-_/]|$)/i],
  ["image", /(?:^|[-_/])(?:flux|imagen|seedream|dall-e|gpt-image|stable-diffusion|sdxl|image)(?:[-_/]|$)/i],
];

/**
 * Providers often return only an id from `/models`. Infer unmistakable media
 * ids so a chat diagnostic does not mark a valid TTS/STT/image model failed.
 */
export const getModelKind = (m: Record<string, unknown> | null | undefined, fallback: string | null = null): string | null => {
  const explicit = m?.kind as string | undefined || m?.type as string | undefined;
  if (explicit) return explicit;
  const id = typeof m?.id === "string" ? m.id : typeof m?.name === "string" ? m.name : "";
  return KIND_PATTERNS.find(([, pattern]) => pattern.test(id))?.[0] || fallback;
};

// Capacity metadata for UI badges — icon + label + color per capability.
export const CAPACITY_META = {
  vision: { icon: "Eye", label: "Vision", desc: "Supports image input", color: "text-blue-500" },
  // search: temporarily hidden (feature not wired yet)
  reasoning: { icon: "Brain", label: "Reasoning", desc: "Supports reasoning / thinking", color: "text-amber-500" },
} as const;

export type CapacityKey = keyof typeof CAPACITY_META;
