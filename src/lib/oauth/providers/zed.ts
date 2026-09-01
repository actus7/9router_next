import { ZED_HOSTED_CONFIG } from "../constants/oauth";
import {
  createZedNativeAuthData,
  parseZedCallbackPayload,
  decryptZedAccessToken,
  fetchZedAuthenticatedUser,
  resolveZedOrganizationId,
} from "@/server/llm-gateway/engine/shared/zedAuth";

interface ProviderConfig {
  defaultNativeAppPort: number;
  [key: string]: unknown;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: null;
  expiresIn: null;
  email?: string;
  displayName?: string;
  providerSpecificData: {
    authMethod: string;
    userId: string;
    systemId: string;
    organizationId: string;
  };
}

const zed = {
  config: ZED_HOSTED_CONFIG,
  flowType: "authorization_code",
  callbackPath: "/",
  prepareConfig: async (config: Record<string, unknown>, meta: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const nativeAppPort: number = Number(meta?.nativeAppPort) || (ZED_HOSTED_CONFIG as ProviderConfig).defaultNativeAppPort;
    const auth: Record<string, unknown> = createZedNativeAuthData(config, { nativeAppPort });
    return { ...config, ...auth };
  },
  buildAuthUrl: (config: Record<string, unknown>, _redirectUri: string, _state: string): string => config.authUrl as string,
  exchangeToken: async (config: Record<string, unknown>, code: string, redirectUri: string, codeVerifier: string, _state: string): Promise<Record<string, unknown>> => {
    const { userId, encryptedAccessToken } = parseZedCallbackPayload(code);
    const accessToken: string = decryptZedAccessToken(encryptedAccessToken, codeVerifier);
    return { accessToken, userId, systemId: config.systemId };
  },
  postExchange: async (tokens: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const credentials: Record<string, unknown> = {
      accessToken: tokens.accessToken,
      providerSpecificData: { userId: tokens.userId, systemId: tokens.systemId },
    };
    let userInfo: Record<string, unknown> | null = null;
    try {
      userInfo = await fetchZedAuthenticatedUser(credentials, { config: ZED_HOSTED_CONFIG });
    } catch { /* best-effort */ }
    const organizationId: string = resolveZedOrganizationId(credentials, userInfo);
    return {
      userInfo,
      organizationId,
      email: (userInfo?.email as string) || null,
      name: (userInfo?.name as string) || (userInfo?.display_name as string) || null,
    };
  },
  mapTokens: (tokens: Record<string, unknown>, extra: Record<string, unknown>): MappedTokens => ({
    accessToken: tokens.accessToken as string,
    refreshToken: null,
    expiresIn: null,
    email: (extra?.email as string) || undefined,
    displayName: (extra?.name as string) || undefined,
    providerSpecificData: {
      authMethod: "oauth",
      userId: tokens.userId as string,
      systemId: tokens.systemId as string,
      organizationId: (extra?.organizationId as string) || "",
    },
  }),
};

export default zed;
