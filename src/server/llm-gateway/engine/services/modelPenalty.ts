// Soft, self-healing memory of how each combo model has been behaving, and of
// which model last rescued a conversation. Nothing here excludes a model: a
// penalty only moves it later in the order, and it fades with time and with
// successes, so a model that recovers climbs back without anyone resetting it.
//
// In-memory and per process, like `comboRotationState` beside it. On a
// serverless host each instance learns on its own; that is a known ceiling, not
// a bug — the durable record is the per-request attempt trail.

import { tryCurrentTenantId } from "../host/tenant";

export const PENALTY_PER_429 = 3;
export const PENALTY_PER_FAIL = 1;
export const MAX_PENALTY = 10;
export const DECAY_INTERVAL_MS = 2 * 60 * 1000;
export const STICKY_TTL_MS = 30 * 60 * 1000;

interface PenaltyEntry {
  penalty: number;
  count: number;
  lastHit: number;
}

// Keys include a client-influenced session id for stickies: bound the maps.
const MAX_ENTRIES = 5000;
const penalties = new Map<string, PenaltyEntry>();
const stickies = new Map<string, { model: string; expiresAt: number }>();

const scope = (): string => tryCurrentTenantId() ?? "-";
const penaltyKey = (model: string): string => `${scope()}|${model}`;

function decayed(entry: PenaltyEntry, now: number): number {
  const steps = Math.floor(Math.max(0, now - entry.lastHit) / DECAY_INTERVAL_MS);
  return Math.max(0, entry.penalty - steps);
}

/** Ordinary failure +1, a rate limit +3, never above MAX_PENALTY. */
export function recordModelFailure(model: string, status?: number, now: number = Date.now()): void {
  const key = penaltyKey(model);
  const existing = penalties.get(key);
  if (!existing && penalties.size >= MAX_ENTRIES) {
    for (const [k, entry] of penalties) if (decayed(entry, now) === 0) penalties.delete(k);
    if (penalties.size >= MAX_ENTRIES) return;
  }
  const weight = status === 429 ? PENALTY_PER_429 : PENALTY_PER_FAIL;
  penalties.set(key, {
    penalty: Math.min((existing ? decayed(existing, now) : 0) + weight, MAX_PENALTY),
    count: (existing?.count ?? 0) + 1,
    lastHit: now,
  });
}

/** Answering at all is the strongest counter-evidence: pay one point back. */
export function recordModelSuccess(model: string, now: number = Date.now()): void {
  const key = penaltyKey(model);
  const existing = penalties.get(key);
  if (!existing) return;
  const next = Math.max(0, decayed(existing, now) - 1);
  if (next === 0) penalties.delete(key);
  else penalties.set(key, { ...existing, penalty: next, lastHit: now });
}

export function getModelPenalty(model: string, now: number = Date.now()): number {
  const entry = penalties.get(penaltyKey(model));
  return entry ? decayed(entry, now) : 0;
}

/**
 * The user's order, adjusted: each model's position plus its penalty, ties
 * resolved by the original position. One point means one place, so a lone
 * failure swaps neighbours and only a streak sinks a model.
 */
export function orderByPenalty(models: string[], now: number = Date.now()): string[] {
  return models
    .map((model, index) => {
      const penalty = getModelPenalty(model, now);
      return { model, index, penalty, effective: index + penalty };
    })
    // On a tie the healthy one goes first; between equals the user's order stands.
    .sort((a, b) => a.effective - b.effective || a.penalty - b.penalty || a.index - b.index)
    .map((item) => item.model);
}

export function snapshotModelPenalties(now: number = Date.now()): Array<{ model: string; penalty: number; count: number }> {
  const prefix = `${scope()}|`;
  const rows: Array<{ model: string; penalty: number; count: number }> = [];
  for (const [key, entry] of penalties) {
    if (!key.startsWith(prefix)) continue;
    const penalty = decayed(entry, now);
    if (penalty > 0) rows.push({ model: key.slice(prefix.length), penalty, count: entry.count });
  }
  return rows.sort((a, b) => b.penalty - a.penalty || a.model.localeCompare(b.model));
}

/** Drops this tenant's penalties and stickies; returns how many penalties were carried. */
export function clearModelPenalties(): number {
  const prefix = `${scope()}|`;
  let cleared = 0;
  for (const key of [...penalties.keys()]) {
    if (key.startsWith(prefix)) { penalties.delete(key); cleared += 1; }
  }
  for (const key of [...stickies.keys()]) if (key.startsWith(prefix)) stickies.delete(key);
  return cleared;
}

const stickyKey = (sessionKey: string, comboName: string): string => `${scope()}|${comboName}|${sessionKey}`;

/** After a fallback rescued a conversation, keep using the model that did. */
export function rememberStickyModel(sessionKey: string | undefined, comboName: string, model: string, now: number = Date.now()): void {
  if (!sessionKey) return;
  if (stickies.size >= MAX_ENTRIES) {
    for (const [key, entry] of stickies) if (entry.expiresAt <= now) stickies.delete(key);
    // Still full of live ones: drop the oldest (Map keeps insertion order).
    for (const key of stickies.keys()) { if (stickies.size < MAX_ENTRIES) break; stickies.delete(key); }
  }
  stickies.set(stickyKey(sessionKey, comboName), { model, expiresAt: now + STICKY_TTL_MS });
}

export function getStickyModel(sessionKey: string | undefined, comboName: string, now: number = Date.now()): string | undefined {
  if (!sessionKey) return undefined;
  const key = stickyKey(sessionKey, comboName);
  const entry = stickies.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) { stickies.delete(key); return undefined; }
  return entry.model;
}
