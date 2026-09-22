/**
 * A model's service kind guessed from its id, for listings that say nothing
 * about kind. Shared by the model list (ids with no stored kind) and by
 * discovery (entries a provider did not tag), so both guess the same way.
 */
export function inferKindFromModelId(modelId: string): string {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/.test(lower)) return "image";
  return "llm";
}
