// Per-model request parameters, generically: the modelparams catalog says which
// knobs a model accepts (path, type, range, enum values, applicability rules);
// nothing here knows any provider by name. A lane entry stores values by the
// catalog's dot paths ({"reasoning_effort": "high", "thinking.type": "enabled"}),
// they are validated against the catalog when saved, and merged into the
// outbound request when the entry is tried.
//
// A model the catalog does not know has no spec: it gets no parameters to
// configure, never invented ones.

import { getModelTargetFormat } from "../config/providerModels";
import { getTargetFormat } from "./provider";
import { BY_ID, dropUnsupported, getModel, isApplicable, parseParams, resolveModelId } from "modelparams";

type CatalogId = Parameters<typeof getModel>[0];
export type ParamValue = string | number | boolean | null;
/** Values by catalog path, as stored on a lane entry. */
export type EntryParams = Record<string, ParamValue>;
type Body = Record<string, unknown>;

export interface ParamSpec {
  /** The catalog id this model resolved to, e.g. `z-ai/glm-5.3`. */
  id: string;
  params: ReadonlyArray<{ path: string; type: string; group?: string; default?: unknown; [key: string]: unknown }>;
}

// When several resellers list the same model (GLM-5.3 on z-ai and alibaba), the
// model's own vendor decides: its parameters are the ones the maker documents.
const FIRST_PARTY: ReadonlyArray<readonly [RegExp, string]> = [
  [/^glm/, "z-ai"], [/^qwen/, "alibaba"], [/^(gpt|o\d|chatgpt)/, "openai"], [/^claude/, "anthropic"],
  [/^gemini|^gemma/, "google"], [/^mimo/, "xiaomi"], [/^deepseek/, "deepseek"], [/^(kimi|k\d)/, "moonshot"],
  [/^grok/, "xai"], [/^llama/, "meta"], [/^minimax/, "minimax"], [/^(mistral|codestral|magistral)/, "mistral"],
  [/^(command|aya)/, "cohere"], [/^sonar/, "perplexity"], [/^nemotron/, "nvidia"],
];

function firstPartyOf(model: string): string | null {
  const bare = model.toLowerCase().replace(/^.*\//, "");
  return FIRST_PARTY.find(([pattern]) => pattern.test(bare))?.[1] ?? null;
}

const inCatalog = (id: string): id is CatalogId => Object.hasOwn(BY_ID, id);

/**
 * The catalog id for an upstream model id, or null. `subscription` prefers the
 * plan-priced variant (its parameter set can differ) when the catalog has one.
 */
export function resolveParamModelId(model: string, options: { subscription?: boolean } = {}): string | null {
  const resolved = resolveModelId(model);
  let id: string | null = null;
  if (resolved.ok) {
    id = resolved.id;
  } else if (resolved.reason === "ambiguous") {
    const vendor = firstPartyOf(model);
    id = resolved.matches.find((match) => match.startsWith(`${vendor}/`)) ?? null;
  }
  if (!id) return null;
  if (options.subscription && inCatalog(`${id}-subscription`)) return `${id}-subscription`;
  return inCatalog(id) ? id : null;
}

/** The translator format a provider's requests end up in, for choosing the catalog entry that describes it. */
export function staticTargetFormat(provider: string, upstreamModel: string): string {
  return String(getModelTargetFormat(provider, upstreamModel) || getTargetFormat(provider));
}

export function paramSpecFor(model: string, options: { subscription?: boolean; targetFormat?: string } = {}): ParamSpec | null {
  let id = resolveParamModelId(model, options);
  // The catalog may list the model in several API shapes (plan-priced Responses, plain chat):
  // the one that matches the wire shape is the only one whose paths mean something here.
  if (id && options.targetFormat && !surfaceMatches(getModel(id as CatalogId).apiSurface, options.targetFormat)) {
    const other = resolveParamModelId(model, { subscription: !options.subscription });
    id = other && surfaceMatches(getModel(other as CatalogId).apiSurface, options.targetFormat) ? other : null;
  }
  if (!id || !inCatalog(id)) return null;
  const params = getModel(id).params as unknown as ParamSpec["params"];
  return params.length > 0 ? { id, params } : null;
}

export type SanitizeResult =
  | { ok: true; value: EntryParams }
  | { ok: false; issues: Array<{ path: string; message: string }> };

/** Validates values a user saved against the catalog: unknown paths, ranges and enum values are errors, not silently dropped. */
export function sanitizeEntryParams(id: string, input: unknown): SanitizeResult {
  if (!inCatalog(id)) return { ok: false, issues: [{ path: "", message: `unknown model ${id}` }] };
  const result = parseParams(id, input);
  if (result.success) return { ok: true, value: result.value as EntryParams };
  return { ok: false, issues: result.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
}

function getPath(source: Body, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Body)[segment];
  }
  return current;
}

function setPath(target: Body, path: string, value: unknown): void {
  const segments = path.split(".");
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    current[segment] = typeof next === "object" && next !== null && !Array.isArray(next) ? { ...(next as Body) } : {};
    current = current[segment] as Body;
  }
  current[segments[segments.length - 1]] = value;
}

function deletePath(target: Body, path: string): void {
  const segments = path.split(".");
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (typeof next !== "object" || next === null) return;
    current[segment] = { ...(next as Body) };
    current = current[segment] as Body;
  }
  delete current[segments[segments.length - 1]];
}

/**
 * The request with the entry's configured values merged in: they win over the
 * client's at the paths they set, everything else the client sent stays, and a
 * parameter the final values make inapplicable (Anthropic's `top_p` beside a
 * `temperature` other than 1) is removed. Never mutates `body`.
 */
export function applyEntryParams<T extends Body>(body: T, id: string, configured: EntryParams | null | undefined): T {
  if (!configured || Object.keys(configured).length === 0 || !inCatalog(id)) return body;
  // Configured values are checked together first, so one conflicting pair does not reach the wire.
  const { params: usable } = dropUnsupported(id, configured as never) as { params: EntryParams };
  const out: Body = JSON.parse(JSON.stringify(body));
  for (const [path, value] of Object.entries(usable)) setPath(out, path, value);

  const specs = getModel(id).params as unknown as ParamSpec["params"];
  const effective: Record<string, unknown> = {};
  for (const { path } of specs) {
    const value = getPath(out, path);
    if (value !== undefined) effective[path] = value;
  }
  for (const { path } of specs) {
    if (Object.hasOwn(usable, path) || getPath(out, path) === undefined) continue;
    if (!isApplicable(id, path as never, effective as never)) deletePath(out, path);
  }
  return out as T;
}

/**
 * `applyEntryParams` for a request in flight: the catalog model is resolved from
 * the upstream id (the plan-priced variant for an OAuth connection), and a model
 * the catalog does not know is returned as it came.
 */
export function applyConfiguredEntryParams<T extends Body>(body: T, upstreamModel: string, configured: EntryParams | null | undefined, authType?: string, targetFormat?: string): T {
  if (!configured || Object.keys(configured).length === 0) return body;
  const id = resolveParamModelId(upstreamModel, { subscription: authType === "oauth" });
  if (!id || !inCatalog(id)) return body;
  // The catalog's paths are the API's own: they only describe the body when it
  // is in that API's shape. A body in another shape (Gemini, Kiro, Cursor…)
  // would get fields that mean nothing there, so it is left as translated.
  if (targetFormat !== undefined && !surfaceMatches(getModel(id).apiSurface, targetFormat)) return body;
  return applyEntryParams(body, id, configured);
}

const SURFACE_FORMATS: Record<string, readonly string[]> = {
  "openai-chat-completions": ["openai"],
  "openai-responses": ["openai-responses", "openai-response", "codex"],
  "anthropic-messages": ["claude"],
};

/** Whether a catalog entry's API surface is the wire shape of a translator target format. */
export function surfaceMatches(apiSurface: string, targetFormat: string): boolean {
  return SURFACE_FORMATS[apiSurface]?.includes(targetFormat) ?? false;
}
