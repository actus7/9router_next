// Host adapter — shared provider display catalog (categories, aliases, TTS
// and media config).
//
// This is pure host-side data. The engine reads it but never mutates it.
// Kept separate from the client-safe @/shared/llm-catalog barrel contract.
export {
  AI_PROVIDERS,
  getProviderAlias,
  resolveProviderId,
} from "@/shared/constants/providers";
