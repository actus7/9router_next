import type { AccentColorId } from "@/shared/constants/accentColors";
export interface Settings {
  fallbackStrategy?: string;
  freeFallbackEnabled?: boolean;
  comboStrategy?: string;
  stickyRoundRobinLimit?: number;
  comboStickyRoundRobinLimit?: number;
  enableObservability?: boolean;
  outboundProxyEnabled?: boolean;
  outboundProxyUrl?: string;
  outboundNoProxy?: string;
  decisionEngine?: "heuristic" | "jev";
  jevSmartRouting?: boolean;
  jevMemoryReview?: boolean;
  jevPluginSelection?: boolean;
  jevWriteRisk?: boolean;
  jevSynapse?: boolean;
  jevErrorClassification?: boolean;
  jevGuardrails?: boolean;
  jevSkillScan?: boolean;
  jevLoopControl?: boolean;
  jevDelegateModel?: boolean;
  jevRerank?: boolean;
  jevInventory?: boolean;
  jevSuggestRouting?: boolean;
  jevUsageTaxonomy?: boolean;
  guardrailsPublicApi?: boolean;
  synapseLearningEnabled?: boolean;
  [key: string]: unknown;
}

export interface StatusMessage {
  type: string;
  message: string;
}

export interface ProfileClientProps {
  initialSettings: Settings;
  initialAccent: AccentColorId;
}
