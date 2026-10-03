// Public server API of the LLM gateway — smart routing.
import "server-only";

export {
  refreshDeterministicSmartProfiles,
  invalidateSmartProfileCache,
} from "@/server/llm-gateway/engine/services/smart-routing/inventory";
export {
  validateSmartRoutingConfig,
} from "@/server/llm-gateway/engine/services/smart-routing/router";
export {
  ROUTING_TIERS,
  ROUTE_NEEDS,
  DEFAULT_SMART_ROUTING_CONFIG,
} from "@/server/llm-gateway/engine/services/smart-routing/types";
export {
  AA_TIER_WEIGHTS,
  TOKEN_MIX_INPUT,
  TOKEN_MIX_OUTPUT,
  computeAaTierScores,
  buildAaSuggestionReason,
  attachAaScoresAndReasons,
} from "@/server/llm-gateway/engine/services/smart-routing/aaScoring";
export type {
  RoutingTier,
  RouteNeed,
  SmartModelProfile,
  AaModelMetrics,
  AaSnapshotMeta,
} from "@/server/llm-gateway/engine/services/smart-routing/types";
