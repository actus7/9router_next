// TTS provider registry
import googleTts from "./googleTts";
import edgeTts, { fetchEdgeTtsVoices } from "./edgeTts";
import localDevice, { fetchLocalDeviceVoices } from "./localDevice";
import elevenlabs, { fetchElevenLabsVoices } from "./elevenlabs";
import openai from "./openai";
import openrouter from "./openrouter";
import gemini, { fetchGeminiVoices } from "./gemini";
import xiaomiMimo from "./xiaomi-mimo";
import { FORMAT_HANDLERS } from "./genericFormats";
import { parseModelVoice } from "./_base";

// Special providers with custom synthesize() logic
/* eslint-disable @typescript-eslint/no-explicit-any */
const SPECIAL_ADAPTERS: Record<string, { noAuth?: boolean; synthesize: (...args: any[]) => Promise<{ base64: string; format: string }> }> = {
/* eslint-enable @typescript-eslint/no-explicit-any */
  "google-tts": googleTts,
  "edge-tts": edgeTts,
  "local-device": localDevice,
  elevenlabs,
  openai,
  openrouter,
  gemini,
  "xiaomi-mimo": xiaomiMimo,
};

export function getTtsAdapter(provider: string) {
  return SPECIAL_ADAPTERS[provider] || null;
}

// Generic config-driven dispatcher (uses ttsConfig.format)
export async function synthesizeViaConfig(provider: string, text: string, model: string, credentials: Record<string, unknown>): Promise<{ base64: string; format: string } | null> {
  const { AI_PROVIDERS } = await import("../../host/catalog");
  const cfg = (AI_PROVIDERS[provider]?.ttsConfig || {}) as Record<string, unknown>;
  if (!cfg) return null;
  const handler = FORMAT_HANDLERS[cfg.format as string];
  if (!handler) return null;
  const apiKey = credentials?.apiKey as string;
  if (cfg.authType !== "none" && !apiKey) throw new Error(`${provider} API key required`);
  const { PROVIDER_MODELS } = await import("../../config/providerModels");
  const ttsModels = ((PROVIDER_MODELS[provider] || []) as Array<{ id?: string; kind?: string; type?: string }>).filter(m => (m.kind || m.type) === "tts");
  const defaultModel = ttsModels[0]?.id || "";
  const { modelId, voiceId } = parseModelVoice(model, defaultModel, "", ttsModels);
  return handler({ baseUrl: cfg.baseUrl as string, apiKey, text, modelId, voiceId });
}

// Voice fetchers (used by /api/media-providers/tts/voices route)
/* eslint-disable @typescript-eslint/no-explicit-any */
export const VOICE_FETCHERS: Record<string, (...args: any[]) => Promise<unknown[]>> = {
/* eslint-enable @typescript-eslint/no-explicit-any */
  "edge-tts": fetchEdgeTtsVoices,
  "local-device": fetchLocalDeviceVoices,
  elevenlabs: fetchElevenLabsVoices,
  gemini: fetchGeminiVoices,
};

// Re-export for backward compat
export { fetchEdgeTtsVoices, fetchLocalDeviceVoices, fetchElevenLabsVoices, fetchGeminiVoices };
