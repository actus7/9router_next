export const GEMINI_CLI_MODELS_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";

// The /codex/models endpoint gates each entry by minimal_client_version against this
// value, and codex CLI's own manifest (openai/codex codex-rs/models-manager/models.json)
// already requires 0.144.0 for its newest models, so a stale client_version here comes
// back 200 with those entries quietly missing instead of erroring.
export const CODEX_CLIENT_VERSION = "0.144.6";
export const CODEX_MODELS_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLIENT_VERSION}`;

export const parseOpenAIStyleModels = (data: unknown): Record<string, unknown>[] => {
  const models = Array.isArray(data)
    ? data
    : ((data as Record<string, unknown>)?.data || (data as Record<string, unknown>)?.models || (data as Record<string, unknown>)?.results || []) as unknown[];
  if (!Array.isArray(models)) return [];
  return models.flatMap((model) => {
    if (typeof model === "string" && model.trim()) return [{ id: model, name: model }];
    if (!model || typeof model !== "object" || Array.isArray(model)) return [];
    const record = model as Record<string, unknown>;
    const id = [record.id, record.model, record.name, record.slug].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    return id ? [{ ...record, id, name: typeof record.name === "string" ? record.name : id }] : [];
  });
};

// Google returns model resources as `models/{id}` while the rest of the
// gateway (catalogue, routing, and chat) uses the canonical bare `{id}`.
// Normalize at the API boundary so a catalogue refresh cannot mistake every
// configured Gemini model for a removed one.
export const parseGeminiModels = (data: Record<string, unknown>): Record<string, unknown>[] => {
  const models = Array.isArray(data?.models) ? data.models as Record<string, unknown>[] : [];
  return models.map((model) => {
    const rawId = typeof model?.id === "string"
      ? model.id
      : typeof model?.name === "string"
        ? model.name
        : typeof model?.model === "string"
          ? model.model
          : "";
    const id = rawId.replace(/^models\//, "");
    if (!id) return model;
    return {
      ...model,
      id,
      name: (typeof model.displayName === "string" && model.displayName) || id,
    };
  });
};

export const parseGeminiCliModels = (data: Record<string, unknown>): Array<{ id: string; name: string }> => {
  if (Array.isArray(data?.models)) {
    return data.models
      .map((item: Record<string, unknown>) => {
        const id = (item?.id || item?.model || item?.name) as string;
        if (!id) return null;
        return { id, name: (item?.displayName || item?.name || id) as string };
      })
      .filter(Boolean) as Array<{ id: string; name: string }>;
  }

  if (data?.models && typeof data.models === "object") {
    return Object.entries(data.models as Record<string, Record<string, unknown>>)
      .filter(([, info]) => !info?.isInternal)
      .map(([id, info]) => ({
        id,
        name: (info?.displayName || info?.name || id) as string,
      }));
  }

  return [];
};

const appendCodexReviewModels = (models: Record<string, unknown>[]): Record<string, unknown>[] => models.flatMap((model) => {
  const id = (model?.id || model?.slug || model?.model || model?.name) as string;
  if (!id) return [];
  const name = (model?.display_name || model?.displayName || model?.name || id) as string;
  const normalized = { ...model, id, name };
  const isChatModel = ((model?.type as string) || "llm") !== "image" && !id.toLowerCase().includes("embed");
  if (!isChatModel || id.endsWith("-review")) return [normalized];
  return [
    normalized,
    {
      ...normalized,
      id: `${id}-review`,
      name: `${name} Review`,
      upstreamModelId: id,
      quotaFamily: "review",
    },
  ];
});

export const parseCodexModels = (data: unknown): Record<string, unknown>[] =>
  appendCodexReviewModels(parseOpenAIStyleModels(data) as Record<string, unknown>[]);

export const createOpenAIModelsConfig = (url: string) => ({
  url,
  method: "GET",
  headers: { "Content-Type": "application/json" },
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  parseResponse: parseOpenAIStyleModels,
});

// Volcengine Ark / BytePlus ModelArk catalog entries carry task_type + domain
// metadata that distinguishes chat (TextGeneration) from embedding/image/video
// models. Map to the gateway's kind vocabulary so consumers (Test All Models,
// custom-model persistence) treat each model with the right endpoint instead of
// pinging image/video models through chat/completions. Entries without metadata
// default to "llm" (previous behavior).
const ARK_KIND_BY_TASK: Array<[RegExp, string]> = [
  [/embedding/i, "embedding"],
  [/texttoimage|imagetoimage|imageedit/i, "image"],
  [/video/i, "video"],
  [/textgeneration|chat/i, "llm"],
];
const arkKindOf = (m: Record<string, unknown>): string => {
  const tasks = Array.isArray(m.task_type) ? m.task_type.map(String) : [];
  const domain = String(m.domain || "");
  for (const [pattern, kind] of ARK_KIND_BY_TASK) {
    if (tasks.some((t) => pattern.test(t)) || (domain && pattern.test(domain))) return kind;
  }
  return "llm";
};
const parseArkModels = (data: unknown): Record<string, unknown>[] =>
  (parseOpenAIStyleModels(data) as Record<string, unknown>[]).map((m) => {
    const id = (m.id || m.name) as string;
    return { ...m, id, name: (m.name || id) as string, kind: arkKindOf(m) };
  });

export const createArkModelsConfig = (url: string) => ({
  url,
  method: "GET",
  headers: { "Content-Type": "application/json" },
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  parseResponse: parseArkModels,
});
