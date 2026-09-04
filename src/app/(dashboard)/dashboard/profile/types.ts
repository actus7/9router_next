export interface Settings {
  fallbackStrategy?: string;
  freeFallbackEnabled?: boolean;
  comboStrategy?: string;
  stickyRoundRobinLimit?: number;
  comboStickyRoundRobinLimit?: number;
  requireLogin?: boolean;
  hasPassword?: boolean;
  authMode?: string;
  ssoType?: string;
  oidcConfigured?: boolean;
  samlConfigured?: boolean;
  enableObservability?: boolean;
  outboundProxyEnabled?: boolean;
  outboundProxyUrl?: string;
  outboundNoProxy?: string;
  oidcIssuerUrl?: string;
  oidcClientId?: string;
  oidcScopes?: string;
  oidcLoginLabel?: string;
  samlEntryPoint?: string;
  samlIssuer?: string;
  samlCert?: string;
  samlLoginLabel?: string;
  samlAttributeEmail?: string;
  samlAttributeName?: string;
  [key: string]: unknown;
}

export interface StatusMessage {
  type: string;
  message: string;
}

export interface ProfileClientProps {
  initialSettings: Settings;
  initialDbInfo: Record<string, unknown>;
}
