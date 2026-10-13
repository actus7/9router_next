/**
 * What a member or an API key is allowed to use: models, chat plugins and Agent
 * Skills.
 *
 * A policy is a *ceiling*, never a treatment. What the gateway does to a request
 * (abilities, injected skills) is the `GatewayProfile`; this decides what the
 * request may ask for at all.
 *
 * Policies stack in layers — organization, member, key — and a request is
 * allowed only when **every** layer allows it. That is the convention every LLM
 * platform settled on (an OpenAI restricted key, a LiteLLM key's `models`): a
 * key can narrow what its member may do, never widen it.
 *
 * A field left out means "this layer does not restrict it". An empty list is a
 * real answer — "nothing" — and is how a key is shut off without revoking it.
 */

export interface AccessPolicy {
  /**
   * Model names as a client sends them: `"cx/gpt-5.6-sol"`, a combo name
   * (`"dev"`), or a trailing glob (`"cx/*"`, `"*"`). Matching is
   * case-insensitive.
   */
  models?: string[];
  /** Chat plugin ids (`web-search`, `memory`, …). Meaningless on an API key. */
  plugins?: string[];
  /** Agent Skill ids. */
  skills?: string[];
  /**
   * How much this subject — the whole organization, one member, one key — may
   * use. Counted against that subject alone: a member's budget is what that
   * member spent, whichever key they used.
   */
  limits?: UsageLimits;
}

export interface UsageLimits {
  /** Requests per minute. */
  rpm?: number;
  /** Spend per calendar month (UTC), in US dollars, as priced in usage. */
  monthlyBudgetUsd?: number;
}

/** The list fields — what a policy names. `limits` is a quantity, not a list. */
export type AccessField = "models" | "plugins" | "skills";

export const ACCESS_FIELDS: readonly AccessField[] = ["models", "plugins", "skills"];

/** Who a policy row restricts. `org` rows use the tenant id as subject. */
export type AccessSubject = "org" | "member" | "key";

const MAX_ENTRIES = 500;
const MAX_ENTRY_LENGTH = 200;

function normalizeList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const entry = item.trim();
    if (!entry || entry.length > MAX_ENTRY_LENGTH) continue;
    seen.add(entry);
    if (seen.size >= MAX_ENTRIES) break;
  }
  return [...seen];
}

/**
 * The stored or posted shape, cleaned. Unknown keys are dropped; a field that
 * is not a list (or is null) means "no restriction" and is omitted.
 */
export function normalizeAccessPolicy(raw: unknown): AccessPolicy {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const policy: AccessPolicy = {};
  for (const field of ACCESS_FIELDS) {
    const list = normalizeList(source[field]);
    if (list) policy[field] = list;
  }
  const limits = normalizeLimits(source.limits);
  if (limits) policy.limits = limits;
  return policy;
}

const MAX_RPM = 100_000;
const MAX_BUDGET_USD = 1_000_000;

function positive(value: unknown, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, max) : undefined;
}

/** Only positive numbers are limits; zero, negatives and junk mean "no limit". */
function normalizeLimits(raw: unknown): UsageLimits | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const rpm = positive(source.rpm, MAX_RPM);
  const budget = positive(source.monthlyBudgetUsd, MAX_BUDGET_USD);
  const limits: UsageLimits = {};
  if (rpm !== undefined) limits.rpm = Math.max(1, Math.floor(rpm));
  if (budget !== undefined) limits.monthlyBudgetUsd = Math.round(budget * 100) / 100;
  return Object.keys(limits).length > 0 ? limits : undefined;
}

export function parseStoredAccessPolicy(stored: string | null | undefined): AccessPolicy {
  if (!stored) return {};
  try {
    return normalizeAccessPolicy(JSON.parse(stored));
  } catch {
    // A row that does not parse is not "unrestricted": refusing everything is
    // the closed answer for a permission that cannot be read.
    return { models: [], plugins: [], skills: [] };
  }
}

/** True when the policy restricts nothing. */
export function isUnrestricted(policy: AccessPolicy): boolean {
  return ACCESS_FIELDS.every((field) => policy[field] === undefined) && policy.limits === undefined;
}

/** `"cx/*"` matches `"cx/gpt-5"`; `"*"` matches anything; otherwise exact, ignoring case. */
export function matchesPattern(pattern: string, candidate: string): boolean {
  const p = pattern.toLowerCase();
  const c = candidate.toLowerCase();
  if (p.endsWith("*")) return c.startsWith(p.slice(0, -1));
  return p === c;
}

/** Whether one layer lets `field` include any of `candidates`. */
function layerAllows(policy: AccessPolicy, field: AccessField, candidates: readonly string[]): boolean {
  const list = policy[field];
  if (list === undefined) return true;
  return list.some((pattern) => candidates.some((candidate) => matchesPattern(pattern, candidate)));
}

/**
 * Whether every layer allows the thing. `candidates` are the spellings of one
 * thing — for a model, the name as requested and its resolved
 * `provider/model` forms — and a layer allows it when any spelling matches.
 */
export function layersAllow(
  layers: readonly AccessPolicy[],
  field: AccessField,
  candidates: readonly string[],
): boolean {
  return layers.every((policy) => layerAllows(policy, field, candidates));
}

/** Whether any layer restricts `field` at all — lets callers skip resolution work. */
export function layersRestrict(layers: readonly AccessPolicy[], field: AccessField): boolean {
  return layers.some((policy) => policy[field] !== undefined);
}

/** `ids` minus what some layer forbids. */
export function filterAllowed(layers: readonly AccessPolicy[], field: AccessField, ids: readonly string[]): string[] {
  if (!layersRestrict(layers, field)) return [...ids];
  return ids.filter((id) => layersAllow(layers, field, [id]));
}
