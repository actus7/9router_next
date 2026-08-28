// ElevenLabs TTS — voice id with optional model_id prefix
import { Buffer } from "node:buffer";

const VOICES_TTL = 24 * 60 * 60 * 1000;
const _voicesCache = new Map<string, { voices: unknown[]; time: number }>(); // by API key

export async function fetchElevenLabsVoices(apiKey: string): Promise<unknown[]> {
  if (!apiKey) throw new Error("ElevenLabs API key required");
  const now = Date.now();
  const cached = _voicesCache.get(apiKey);
  if (cached && now - cached.time < VOICES_TTL) return cached.voices;

  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`ElevenLabs voices fetch failed: ${res.status}`);
  const data = await res.json() as { voices?: unknown[] };
  // Normalize: derive lang from labels for grouping
  const voices = (data.voices || []).map((v: unknown) => ({ ...(v as Record<string, unknown>), lang: ((v as Record<string, unknown>)?.labels as Record<string, unknown>)?.language || "en" }));
  _voicesCache.set(apiKey, { voices, time: now });
  return voices;
}

export default {
  async synthesize(text: string, model: string, credentials: Record<string, unknown>): Promise<{ base64: string; format: string }> {
    if (!credentials?.apiKey) throw new Error("ElevenLabs API key required");
    let modelId = "eleven_flash_v2_5";
    let voiceId = model;
    if (model && model.includes("/")) [modelId, voiceId] = model.split("/");

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": credentials.apiKey as string, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(((err?.detail as Record<string, unknown>)?.message as string) || `ElevenLabs TTS failed: ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1024) throw new Error("ElevenLabs TTS returned empty audio");
    return { base64: Buffer.from(buf).toString("base64"), format: "mp3" };
  },
};
