import { paramSpecFor, sanitizeEntryParams, type EntryParams } from "../modelParams";
import type { RoutingTier } from "./types";

// Intensity order of the effort values providers use; anything else is not a level we can rank.
const LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];
// Where in the model's own ladder each lane sits (0 = lowest it offers, 1 = highest).
const LANE_POSITION: Record<RoutingTier, number> = { simple: 0, standard: 0.34, complex: 0.67, reasoning: 1 };

/**
 * The parameters the suggestion puts on a lane entry: reasoning effort scaled
 * to the lane, on whatever path the catalog gives this model. Only what the
 * catalog accepts is returned (it is validated, applicability included); `none`
 * is never suggested — turning reasoning off is a product choice, not a lane's.
 * Sampling and length are left alone for the same reason.
 */
export function laneParamHints(upstreamModel: string, tier: RoutingTier, options: { subscription?: boolean } = {}): EntryParams | undefined {
  const spec = paramSpecFor(upstreamModel, options);
  const effort = spec?.params.find((param) => /effort$/.test(param.path) && Array.isArray(param.values));
  if (!spec || !effort) return undefined;
  const ladder = LEVELS.filter((level) => (effort.values as unknown[]).includes(level));
  if (ladder.length === 0) return undefined;
  const value = ladder[Math.round(LANE_POSITION[tier] * (ladder.length - 1))];
  const base: EntryParams = { [effort.path]: value };
  const thinking = spec.params.find((param) => param.path === "thinking.type" && (param.values as unknown[] | undefined)?.includes("enabled"));
  for (const candidate of thinking ? [base, { ...base, "thinking.type": "enabled" }] : [base]) {
    if (sanitizeEntryParams(spec.id, candidate).ok) return candidate;
  }
  return undefined;
}
