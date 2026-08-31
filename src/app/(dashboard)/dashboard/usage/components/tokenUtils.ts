import type { TokenUsage } from "./types";

export function getCachedTokens(tokens: TokenUsage | null | undefined): number {
  return tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
}

export function getCacheCreationTokens(tokens: TokenUsage | null | undefined): number {
  return tokens?.cache_creation_input_tokens || 0;
}

export function getInputTokens(tokens: TokenUsage | null | undefined): number {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  // Canonical storage keeps prompt cache-inclusive. Legacy Claude rows may have
  // stored prompt cache-exclusive; fall back to cache when it's larger so old
  // rows don't under-report input.
  const cache = getCachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}
