import { NextRequest } from "next/server";

import { VOICE_FETCHERS } from "@/server/llm-gateway/media";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { GET as deepgramVoices } from "../../media-providers/tts/deepgram/voices/route";
import { GET as elevenLabsVoices } from "../../media-providers/tts/elevenlabs/voices/route";
import { GET as inworldVoices } from "../../media-providers/tts/inworld/voices/route";

export interface GatewayVoice { id: string; name: string; lang: string; gender: string; model: string }
export type VoiceListResult =
  | { ok: true; data: GatewayVoice[] }
  | { ok: false; status: number; message: string };

type RawVoice = { id: string; name: string; lang?: string; gender?: string };

// Providers keyed by a connection read the account's credential, so they are
// the dashboard use cases called in-process: `/v1/audio/voices` used to reach
// them over HTTP at `/api/media-providers/...`, a cookie-session route, and a
// gateway client has no cookie — every call was a 401. In-process they run
// under the tenant `gatewayRoute` already established from the API key.
const CONNECTION_VOICES: Record<string, (request: NextRequest) => Promise<Response>> = {
  elevenlabs: elevenLabsVoices,
  deepgram: deepgramVoices,
  inworld: inworldVoices,
};

// Keyless providers answer from the engine fetchers directly.
const KEYLESS_VOICES: Record<string, () => Promise<RawVoice[]>> = {
  "edge-tts": async () => ((await VOICE_FETCHERS["edge-tts"]()) as Record<string, string>[]).map((v) => ({
    id: v.ShortName,
    name: (v.FriendlyName || v.ShortName).replace("Microsoft ", "").replace(/ Online \(Natural\) - /g, " ("),
    lang: v.Locale.split("-")[0],
    gender: v.Gender,
  })),
  "local-device": async () => (await VOICE_FETCHERS["local-device"]()) as RawVoice[],
};

export const VOICE_PROVIDERS: readonly string[] = [...Object.keys(CONNECTION_VOICES), ...Object.keys(KEYLESS_VOICES)];

async function rawVoices(provider: string, lang: string | null): Promise<RawVoice[] | { status: number; message: string }> {
  const keyless = KEYLESS_VOICES[provider];
  if (keyless) {
    const voices = await keyless();
    return lang ? voices.filter((v) => v.lang === lang) : voices;
  }
  const url = new URL(`http://internal/voices${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`);
  const res = await CONNECTION_VOICES[provider](new NextRequest(url));
  const data = await res.json();
  if (!res.ok || data.error) return { status: res.status, message: data.error || `Upstream ${res.status}` };
  // Use-case shape: { voices } when filtered by lang, else { byLang }.
  return lang
    ? (data.voices || [])
    : (Object.values(data.byLang || {}) as Array<{ voices?: RawVoice[] }>).flatMap((l) => l.voices || []);
}

/**
 * Voices of a TTS provider, each with the model id `/v1/audio/speech` takes.
 * Must run inside a tenant scope — the connection-backed providers read the
 * account's credential.
 */
export async function listGatewayVoices(provider: string, lang: string | null): Promise<VoiceListResult> {
  if (!VOICE_PROVIDERS.includes(provider)) {
    return { ok: false, status: 400, message: `provider must be one of: ${VOICE_PROVIDERS.join(", ")}` };
  }
  const voices = await rawVoices(provider, lang);
  if (!Array.isArray(voices)) return { ok: false, ...voices };

  // Provider alias for the /v1/audio/speech model param (el/, dg/, edge-tts/…).
  const alias = AI_PROVIDERS[provider]?.alias || provider;
  return {
    ok: true,
    data: voices.map((v) => ({ id: v.id, name: v.name, lang: v.lang || "", gender: v.gender || "", model: `${alias}/${v.id}` })),
  };
}
