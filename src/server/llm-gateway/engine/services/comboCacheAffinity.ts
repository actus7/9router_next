import { conversationPrefixKey } from "../host/modelStats";
import { getStickyModel, rememberStickyModel } from "./modelPenalty";
import type { RoutingDecisionMeta } from "./smart-routing/types";

// A large prompt is mostly cache on the model that read it last: moving the
// conversation to another model pays the whole prompt again, cold and slower.
// The warm model rides the sticky store under its own namespace, so it never
// mixes with the adaptive "rescued by" sticky.
const namespace = (comboName: string): string => `${comboName}#warm`;

/** Who "this conversation" is: the client's session id, else its prompt prefix. */
export function cacheAffinityKey(body: Record<string, unknown>, sessionKey: string | undefined): string | undefined {
  return sessionKey ?? conversationPrefixKey(body);
}

/**
 * The model holding the conversation's cache first, when it is still a candidate.
 * `allowed` narrows that to the column of the smart combo's classified tier:
 * its list also carries "always considered" models (tagged with that tier) and
 * other tiers' models as fallback, and a warm one from there must not jump over
 * the column the operator ordered.
 */
export function preferWarmModel(models: string[], comboName: string, key: string, allowed?: ReadonlySet<string>): string[] {
  const warm = getStickyModel(key, namespace(comboName));
  if (!warm || models[0] === warm || !models.includes(warm)) return models;
  if (allowed && !allowed.has(warm)) return models;
  return [warm, ...models.filter((m) => m !== warm)];
}

/** The column of the tier a smart request was classified into; undefined for a plain combo. */
export function classifiedTierModels(decision: RoutingDecisionMeta | null): ReadonlySet<string> | undefined {
  if (!decision) return undefined;
  return new Set(decision.candidateDetails.filter((c) => c.tier === decision.tier && c.column).map((c) => c.model));
}

export function rememberWarmModel(key: string, comboName: string, model: string): void {
  rememberStickyModel(key, namespace(comboName), model);
}
