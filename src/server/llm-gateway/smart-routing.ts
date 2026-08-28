// Public server API of the LLM gateway — smart routing.
import "server-only";

export {
  refreshDeterministicSmartProfiles,
  invalidateSmartProfileCache,
  rankSmartProfiles,
  resolveRequestedTier,
  getSmartTierOrder,
} from "@/lib/open-sse/services/smart-routing/inventory";
export {
  resolveSmartRouting,
  getSmartCombo,
  deriveRoutingSessionKey,
  parseRoutingTierHeader,
  validateSmartRoutingConfig,
  normalizeSmartRoutingConfig,
} from "@/lib/open-sse/services/smart-routing/router";
export {
  ROUTING_TIERS,
  ROUTE_NEEDS,
  DEFAULT_SMART_ROUTING_CONFIG,
} from "@/lib/open-sse/services/smart-routing/types";
export type {
  RoutingTier,
  RoutingTierOrDefault,
  RouteNeed,
  SmartModelProfile,
  RoutingReason,
  RoutingDecisionMeta,
  SmartComboEntry,
  SmartRoutingConfig,
} from "@/lib/open-sse/services/smart-routing/types";
