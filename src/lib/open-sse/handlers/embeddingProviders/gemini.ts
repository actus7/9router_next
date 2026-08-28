// Google Gemini embeddings — embedContent / batchEmbedContents
const BASE = "https://generativelanguage.googleapis.com/v1beta";

function modelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

export default {
  buildUrl: (model: string, creds: Record<string, unknown>, { input }: { input?: unknown } = {}) => {
    const apiKey = (creds as Record<string, unknown>).apiKey || (creds as Record<string, unknown>).accessToken;
    const path = modelPath(model);
    const op = Array.isArray(input) ? "batchEmbedContents" : "embedContent";
    return `${BASE}/${path}:${op}?key=${encodeURIComponent(String(apiKey))}`;
  },
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: (model: string, { input, dimensions }: { input: unknown; dimensions: unknown }) => {
    const m = modelPath(model);
    const outputDimensionality = Number(dimensions);
    const hasOutputDimensionality = Number.isFinite(outputDimensionality) && outputDimensionality > 0;
    if (Array.isArray(input)) {
      return {
        requests: input.map((text: unknown) => ({
          model: m,
          content: { parts: [{ text: String(text) }] },
          ...(hasOutputDimensionality ? { outputDimensionality } : {}),
        })),
      };
    }
    return {
      model: m,
      content: { parts: [{ text: String(input) }] },
      ...(hasOutputDimensionality ? { outputDimensionality } : {}),
    };
  },
  normalize: (responseBody: Record<string, unknown>, model: string) => {
    if (responseBody.object === "list" && Array.isArray(responseBody.data)) return responseBody;
    let items: Record<string, unknown>[] = [];
    if (Array.isArray(responseBody.embeddings)) {
      items = (responseBody.embeddings as Record<string, unknown>[]).map((emb: Record<string, unknown>, idx: number) => ({
        object: "embedding",
        index: idx,
        embedding: emb.values || [],
      }));
    } else if ((responseBody.embedding as Record<string, unknown>)?.values) {
      items = [{ object: "embedding", index: 0, embedding: (responseBody.embedding as Record<string, unknown>).values }];
    }
    return {
      object: "list",
      data: items,
      model,
      usage: { prompt_tokens: 0, total_tokens: 0 },
    };
  },
};
