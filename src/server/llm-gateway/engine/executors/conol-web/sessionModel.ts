// Conol session model/effort configuration. POST /api/sessions ignores
// agentModel/agentEffort in its body — a freshly created session always
// starts on the account default. The web client configures the session
// out-of-band against POST /api/sessions/{id}/model, which accepts three
// payload shapes: preset priming, then an explicit model pin (which resets
// effort to null), then an effort pin. Ordering is load-bearing.
// Ported from OmniRoute's conolSessionModel.ts.

import { clampConolEffort, conolEffortsForModel, type ConolEffort } from "./models";

export const CONOL_ORIGIN = "https://conol.ai";
export const CONOL_DEFAULT_MODEL_PRESET = "pro";

export interface ConolSessionModelPlan {
  preset: { modelPreset: string; hasImageHistory: boolean };
  model: { agentModel: string; agentEffort: null };
  effort: { agentEffort: ConolEffort } | null;
}

export function buildConolSessionModelPlan(options: { model: string; effort: ConolEffort; hasImageHistory: boolean }): ConolSessionModelPlan {
  const supported = conolEffortsForModel(options.model);
  const effort = clampConolEffort(options.effort, supported);
  return {
    preset: { modelPreset: CONOL_DEFAULT_MODEL_PRESET, hasImageHistory: options.hasImageHistory },
    model: { agentModel: options.model, agentEffort: null },
    effort: effort ? { agentEffort: effort } : null,
  };
}

export function conolSessionModelUrl(sessionId: string): string {
  return `${CONOL_ORIGIN}/api/sessions/${encodeURIComponent(sessionId)}/model`;
}

export interface ApplyConolSessionModelOptions {
  sessionId: string;
  plan: ConolSessionModelPlan;
  skipPreset?: boolean;
  buildHeaders: (sessionId: string) => Record<string, string>;
  signal?: AbortSignal | null;
  onWarning?: (message: string) => void;
}

export interface AppliedConolSessionModel {
  presetApplied: boolean;
  modelApplied: boolean;
  effortApplied: ConolEffort | null;
}

async function postSessionModel(url: string, body: unknown, options: ApplyConolSessionModelOptions): Promise<boolean> {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...options.buildHeaders(options.sessionId), "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal ?? undefined,
  });
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok) {
    options.onWarning?.(`Conol session model update failed (HTTP ${response.status}) for ${JSON.stringify(body)}`);
    return false;
  }
  return true;
}

/** Apply preset → model → effort in order — the model call nulls effort, so
 * applying effort first would silently drop it. Failures are non-fatal: the
 * turn still runs on Conol's current/default model. */
export async function applyConolSessionModel(options: ApplyConolSessionModelOptions): Promise<AppliedConolSessionModel> {
  const url = conolSessionModelUrl(options.sessionId);
  const applied: AppliedConolSessionModel = { presetApplied: false, modelApplied: false, effortApplied: null };

  if (!options.skipPreset) applied.presetApplied = await postSessionModel(url, options.plan.preset, options);
  applied.modelApplied = await postSessionModel(url, options.plan.model, options);
  if (applied.modelApplied && options.plan.effort) {
    const ok = await postSessionModel(url, options.plan.effort, options);
    if (ok) applied.effortApplied = options.plan.effort.agentEffort;
  }
  return applied;
}
