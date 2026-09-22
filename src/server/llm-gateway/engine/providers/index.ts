// Single source: build PROVIDERS + PROVIDER_MODELS from registry/{id}.js (transport + models co-located).
import REGISTRY from "./registry/index";
import { PROVIDER_DEFAULTS } from "./schema";
import { normalizeModel } from "./models/schema";
import { MEDIA_ENTRY_KEYS } from "./mediaKeys";
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

const MEDIA_KEYS: Set<string> = new Set(MEDIA_ENTRY_KEYS);

export const PROVIDERS: Record<string, Record<string, unknown>> = {};
export const PROVIDER_MODELS: Record<string, Record<string, unknown>[]> = {};
/** Per-model metadata a discovered catalogue cannot carry, keyed by alias then model id. */
export const PROVIDER_MODEL_OVERRIDES: Record<string, Record<string, Record<string, unknown>>> = {};
export const PROVIDER_OAUTH: Record<string, Record<string, unknown>> = {};
export const PROVIDER_MEDIA: Record<string, Record<string, unknown>> = {};
/**
 * Providers whose upstream never sees `tools` (`features.toolCalling: false`),
 * by id and every alias. A model there inherits `tools: true` from its
 * canonical name — `da/claude-haiku-4-5` is "Claude" — which routed tool
 * requests to a provider that answered in prose instead of calling the tool.
 */
export const NO_TOOL_CALLING_PROVIDERS: Set<string> = new Set();
for (const entry of REGISTRY as Record<string, unknown>[]) {
  const e = entry as Record<string, unknown>;
  if (e.transport) {
    PROVIDERS[e.id as string] = buildTransport(e.transport as Record<string, unknown>, e.oauth as Record<string, unknown> | undefined);
    if (e.transports) PROVIDERS[e.id as string].transports = e.transports;
  }
  if (e.models !== undefined) PROVIDER_MODELS[(e.alias as string) || (e.id as string)] = (e.models as (string | Record<string, unknown>)[]).map(normalizeModel);
  if (e.modelOverrides !== undefined) PROVIDER_MODEL_OVERRIDES[(e.alias as string) || (e.id as string)] = e.modelOverrides as Record<string, Record<string, unknown>>;
  if (e.oauth) PROVIDER_OAUTH[e.id as string] = e.oauth as Record<string, unknown>;
  if ((e.features as Record<string, unknown> | undefined)?.toolCalling === false) {
    for (const name of [e.id, e.alias, e.uiAlias, ...((e.aliases as unknown[]) || [])]) {
      if (typeof name === "string" && name) NO_TOOL_CALLING_PROVIDERS.add(name);
    }
  }
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
