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
