// OpenAI TTS — model format: "tts-model/voice"
import { Buffer } from "node:buffer";
import { PROVIDER_MEDIA } from "../../providers/index";

const DEFAULT_TTS_MODEL = (PROVIDER_MEDIA["openai"]?.ttsConfig as Record<string, unknown>)?.defaultModel as string;

export default {
  async synthesize(text: string, model: string, credentials: Record<string, unknown>): Promise<{ base64: string; format: string }> {
    if (!credentials?.apiKey) throw new Error("No OpenAI API key configured");

    let ttsModel = DEFAULT_TTS_MODEL;
    let voice = "alloy";
    if (model && model.includes("/")) {
      const parts = model.split("/");
      if (parts.length === 2) [ttsModel, voice] = parts;
    } else if (model) {
      voice = model;
    }

    const baseUrl = ((credentials.baseUrl as string) || "https://api.openai.com").replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${credentials.apiKey}` },
      body: JSON.stringify({ model: ttsModel, voice, input: text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(((err?.error as Record<string, unknown>)?.message as string) || `OpenAI TTS failed: ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return { base64: Buffer.from(buf).toString("base64"), format: "mp3" };
  },
};
