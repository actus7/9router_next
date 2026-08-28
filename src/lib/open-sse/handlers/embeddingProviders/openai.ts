// OpenAI-compatible embeddings adapter (most providers)
import { bearerAuth } from "./_base";
import { PROVIDER_MEDIA } from "../../providers/index";

// media-only providers without a registry file keep URL here; rest derive from registry media.embeddingConfig.baseUrl
const ENDPOINTS: Record<string, string> = {
  "jina-ai": "https://api.jina.ai/v1/embeddings",
};

const embedCfg = (id: string) => (PROVIDER_MEDIA[id] as Record<string, unknown>)?.embeddingConfig as Record<string, unknown> || {};
const embedUrl = (id: string) => (embedCfg(id).baseUrl as string) || ENDPOINTS[id];

export default function createOpenAIEmbeddingAdapter(providerId: string) {
  const cfg = embedCfg(providerId);
  return {
    buildUrl: () => embedUrl(providerId),
    buildHeaders: (creds: Record<string, unknown>) => {
      return { "Content-Type": "application/json", ...bearerAuth(creds), ...((cfg.headers as Record<string, string>) || {}) };
    },
    buildBody: (model: string, { input, encoding_format, dimensions }: { input: unknown; encoding_format?: string; dimensions?: unknown }) => {
      const body: Record<string, unknown> = { model, input };
      if (encoding_format) body.encoding_format = encoding_format;
      if (dimensions != null && dimensions !== "") {
        const dim = Number(dimensions);
        if (Number.isFinite(dim) && dim > 0) body.dimensions = dim;
      }
      return body;
    },
    normalize: (responseBody: Record<string, unknown>) => responseBody,
  };
}
