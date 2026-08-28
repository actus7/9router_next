// Public server API of the LLM gateway â€” umbrella entrypoint.
// Prefer the per-modality modules (chat/embeddings/media/search/auth/catalog/
// smart-routing/translator/usage); this barrel exists for consumers that need
// the whole surface.
import "server-only";

export * from "./chat";
export * from "./embeddings";
export * from "./media";
export * from "./search";
export * from "./auth";
export * from "./catalog";
export * from "./smart-routing";
export * from "./translator";
export * from "./usage";

// Runtime knobs consumed directly by routes
export { GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS } from "@/server/llm-gateway/engine/config/runtimeConfig";
