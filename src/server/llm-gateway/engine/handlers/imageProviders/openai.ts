// OpenAI-compatible adapter (used by openai, minimax, openrouter, recraft)
import { PROVIDER_MEDIA } from "../../providers/index";

const imageCfg = (id: string): Record<string, unknown> => (PROVIDER_MEDIA[id]?.imageConfig || {}) as Record<string, unknown>;
const imageUrl = (id: string): string => (imageCfg(id).baseUrl as string) || "";

export default function createOpenAIAdapter(providerId: string) {
  const cfg = imageCfg(providerId);
  return {
    buildUrl: (): string => imageUrl(providerId),
    buildHeaders: (creds: Record<string, unknown>): Record<string, string> => {
      const headers: Record<string, string> = { "Content-Type": "application/json", ...((cfg.headers || {}) as Record<string, string>) };
      const key = (creds?.apiKey || creds?.accessToken) as string | undefined;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      return headers;
    },
    buildBody: (model: string, body: Record<string, unknown>): Record<string, unknown> => {
      const { prompt, n = 1, size = "1024x1024", quality, style, response_format } = body;
      const full: Record<string, unknown> = { model, prompt, n, size };
      if (quality) full.quality = quality;
      if (style) full.style = style;
      if (response_format) full.response_format = response_format;
      // bodyFields whitelist (e.g. xAI accepts only model/prompt/n/response_format)
      if (Array.isArray(cfg.bodyFields)) {
        const req: Record<string, unknown> = {};
        for (const f of cfg.bodyFields) if (full[f as string] !== undefined) req[f as string] = full[f as string];
        return req;
      }
      return full;
    },
    normalize: (responseBody: Record<string, unknown>): Record<string, unknown> => responseBody,
  };
}
