// Single source: build PROVIDERS + PROVIDER_MODELS from registry/{id}.js (transport + models co-located).
import REGISTRY from "./registry/index";
import { PROVIDER_DEFAULTS } from "./schema";
import { normalizeModel } from "./models/schema";
import { buildTtsProviderModels } from "../config/ttsModels";

// oauth block is canonical for these fields; inject into transport so executors reading
// this.config.{clientId,clientSecret,tokenUrl} keep working without duplicating in transport
const OAUTH_INJECT_FIELDS = ["clientId", "clientSecret", "tokenUrl"];

// transport: re-apply shared default (format:"openai") + inject oauth-canonical fields
function buildTransport(transport: Record<string, unknown>, oauth?: Record<string, unknown>) {
  const t: Record<string, unknown> = { ...transport };
  if (!t.format) t.format = PROVIDER_DEFAULTS.format;
  if (oauth) {
    for (const f of OAUTH_INJECT_FIELDS) {
      if (t[f] === undefined && oauth[f] !== undefined) t[f] = oauth[f];
    }
  }
  return t;
}

const MEDIA_KEYS = new Set([
  "serviceKinds", "ttsConfig", "sttConfig", "embeddingConfig",
  "imageConfig", "imageToTextConfig", "videoConfig", "musicConfig",
  "searchViaChat", "searchConfig", "fetchConfig",
  "modelsFetcher", "mediaPriority", "hiddenKinds",
]);

export const PROVIDERS: Record<string, Record<string, unknown>> = {};
export const PROVIDER_MODELS: Record<string, Record<string, unknown>[]> = {};
export const PROVIDER_OAUTH: Record<string, Record<string, unknown>> = {};
export const PROVIDER_MEDIA: Record<string, Record<string, unknown>> = {};
for (const entry of REGISTRY as Record<string, unknown>[]) {
  const e = entry as Record<string, unknown>;
  if (e.transport) {
    PROVIDERS[e.id as string] = buildTransport(e.transport as Record<string, unknown>, e.oauth as Record<string, unknown> | undefined);
    if (e.transports) PROVIDERS[e.id as string].transports = e.transports;
  }
  if (e.models !== undefined) PROVIDER_MODELS[(e.alias as string) || (e.id as string)] = (e.models as (string | Record<string, unknown>)[]).map(normalizeModel);
  if (e.oauth) PROVIDER_OAUTH[e.id as string] = e.oauth as Record<string, unknown>;
  // Build PROVIDER_MEDIA from top-level fields (post-migration) + legacy entry.media
  const mediaFields: Record<string, unknown> = {};
  for (const k of MEDIA_KEYS) {
    if (e[k] !== undefined) mediaFields[k] = e[k];
  }
  if (e.media) Object.assign(mediaFields, e.media);
  if (Object.keys(mediaFields).length) PROVIDER_MEDIA[e.id as string] = mediaFields;
}

// TTS model/voice tables keyed by special names (openai-tts-models, ...), not provider ids
Object.assign(PROVIDER_MODELS, buildTtsProviderModels());
