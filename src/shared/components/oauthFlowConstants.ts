// Providers using the dynamic-port local callback proxy.
// Browser OAuth: popup → auto callback → auto exchange → poll-status.
export const PROXY_OAUTH_PROVIDERS = new Set(["zed"]);

export interface ProviderInfo {
  name?: string;
}

export interface UseOAuthFlowProps {
  isOpen: boolean;
  provider?: string;
  onSuccess?: () => void;
  onClose: () => void;
  oauthMeta?: Record<string, string>;
  /** Optional Kiro IDC config for AWS IAM Identity Center device flow */
  idcConfig?: {
    startUrl?: string;
    region?: string;
  };
}
