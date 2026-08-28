import { Buffer } from "node:buffer";
import { createErrorResult } from "../utils/error";
import { HTTP_STATUS } from "../config/runtimeConfig";
import { getTtsAdapter, synthesizeViaConfig } from "./ttsProviders/index";

// Re-export voice fetchers + voices APIs for backward compat with existing routes
export {
  VOICE_FETCHERS,
  fetchEdgeTtsVoices,
  fetchLocalDeviceVoices,
  fetchElevenLabsVoices,
} from "./ttsProviders/index";

// ── Response Formatter (DRY) ───────────────────────────────────
function createTtsResponse(base64Audio: string, format: string, responseFormat: string) {
  const audioBuffer = Buffer.from(base64Audio, "base64");

  // JSON format: return base64 encoded audio
  if (responseFormat === "json") {
    return {
      success: true,
      response: new Response(JSON.stringify({ audio: base64Audio, format }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }),
    };
  }

  // Binary format (default): return raw audio
  return {
    success: true,
    response: new Response(audioBuffer, {
      headers: {
        "Content-Type": `audio/${format}`,
        "Content-Length": String(audioBuffer.length),
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}

// ── Core handler ───────────────────────────────────────────────
/**
 * Synthesize text to audio. Provider logic lives in `./ttsProviders/{id}.js`
 * or is dispatched generically via `ttsConfig.format`.
 *
 * @returns {Promise<{success, response, status?, error?}>}
 */
export async function handleTtsCore({ provider, model, input, credentials, responseFormat = "mp3", language, style }: {
  provider: string;
  model: string;
  input: string;
  credentials: Record<string, unknown>;
  responseFormat?: string;
  language?: string;
  style?: string;
}) {
  if (!input?.trim()) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: input", undefined);
  }

  try {
    // Special-case adapters (google-tts, edge-tts, local-device, elevenlabs, openai, openrouter, gemini, xiaomi-mimo)
    const adapter = getTtsAdapter(provider);
    if (adapter) {
      const result = await adapter.synthesize(input.trim(), model, credentials, responseFormat, { language, style });
      // Adapter may return a full {success, response} (legacy) or {base64, format}
      if ((result as Record<string, unknown>).success !== undefined) return result;
      return createTtsResponse((result as Record<string, unknown>).base64 as string, (result as Record<string, unknown>).format as string, responseFormat);
    }

    // Generic config-driven (hyperbolic, deepgram, nvidia, huggingface, inworld, cartesia, playht, coqui, tortoise, qwen, ...)
    const result = await synthesizeViaConfig(provider, input.trim(), model, credentials);
    if (result) return createTtsResponse((result as Record<string, unknown>).base64 as string, (result as Record<string, unknown>).format as string, responseFormat);

    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support TTS via this route.`, undefined);
  } catch (err: unknown) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, (err as Error).message || "TTS synthesis failed", undefined);
  }
}
