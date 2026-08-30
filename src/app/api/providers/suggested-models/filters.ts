// Free OpenCode models that don't use the "-free" id suffix
const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];

interface ModelItem {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  isFree?: boolean;
  max_completion_tokens?: number;
}

export const FILTERS: Record<string, (models: ModelItem[]) => Array<Record<string, unknown>>> = {
  // Generic OpenAI-compatible /v1/models listing — no filtering beyond dropping
  // non-chat entries, just shape it. This is the type used by the overwhelming
  // majority of modelsFetcher entries (local servers, most cloud free-tier
  // providers). Some catalogs (e.g. OVH AI Endpoints) mix chat models with
  // embedding/TTS/STT/image models in the same /v1/models response with no
  // explicit "task" field — but non-chat entries report
  // max_completion_tokens: 0 (they can't generate completions at all), while
  // every real chat model reports a non-zero value. Only exclude when the
  // field is explicitly present and zero — omitted entirely still passes.
  "openai": (models) =>
    models
      .filter((m) => !!m.id && m.max_completion_tokens !== 0)
      .map((m) => ({ id: m.id, name: m.name || m.id, contextLength: m.context_length })),

  "openrouter-free": (models) =>
    models
      .filter(
        (m) =>
          m.pricing?.prompt === "0" &&
          m.pricing?.completion === "0" &&
          (m.context_length ?? 0) >= 200000
      )
      .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
      .sort((a, b) => ((b.contextLength as number) || 0) - ((a.contextLength as number) || 0)),

  "opencode-free": (models) =>
    models
      .filter((m) => m.id?.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(m.id ?? ""))
      .map((m) => ({ id: m.id, name: m.id })),

  // models.dev returns a large catalog; keep only mimo models
  "mimo-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo"))
      .map((m) => ({ id: m.id, name: m.name || m.id })),
};
