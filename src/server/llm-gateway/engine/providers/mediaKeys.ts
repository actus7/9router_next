// The registry fields that describe a provider's media and search surface.
// Both the engine loader and the client-safe dashboard projection copy these
// fields out of a registry entry, so the list lives here once: dropping a key
// from one copy and not the other silently loses media config on one side.
export const MEDIA_ENTRY_KEYS = [
  "serviceKinds", "ttsConfig", "sttConfig", "embeddingConfig",
  "imageConfig", "imageToTextConfig", "videoConfig", "musicConfig",
  "searchViaChat", "searchConfig", "fetchConfig",
  "modelsFetcher", "mediaPriority", "hiddenKinds",
] as const;

export type MediaEntryKey = typeof MEDIA_ENTRY_KEYS[number];
