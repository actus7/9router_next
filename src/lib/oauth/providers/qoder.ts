import { QODER_CONFIG } from "../constants/oauth";

interface ProviderConfig {
  loginUrl: string;
  [key: string]: unknown;
}

interface DeviceFlowResult {
  nonce: string;
  codeVerifier: string;
  verificationUriComplete: string;
  machineId: string;
}

interface PollResult {
  ok: boolean;
  data: Record<string, unknown>;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  email: string | null;
  displayName: string | null;
  providerSpecificData: {
    authMethod: string;
    userId: string;
    machineId: string;
    organizationId: string;
  };
}

const qoder = {
  config: QODER_CONFIG as ProviderConfig,
  flowType: "device_code",
  requestDeviceCode: async (config: ProviderConfig): Promise<Record<string, unknown>> => {
    const { QoderService } = await import("@/lib/oauth/services/qoder");
    const flow: DeviceFlowResult = new QoderService().initiateDeviceFlow();
    return {
      device_code: flow.nonce,
      user_code: flow.nonce.slice(0, 8).toUpperCase(),
      verification_uri: config.loginUrl,
      verification_uri_complete: flow.verificationUriComplete,
      expires_in: 300,
      interval: 2,
      codeVerifier: flow.codeVerifier,
      _qoderNonce: flow.nonce,
      _qoderMachineId: flow.machineId,
    };
  },
  pollToken: async (config: ProviderConfig, deviceCode: string, codeVerifier: string, extraData: Record<string, unknown>): Promise<PollResult> => {
    const { QoderService } = await import("@/lib/oauth/services/qoder");
    const svc = new QoderService();
    const nonce: string = deviceCode || (extraData?._qoderNonce as string);
    const verifier: string = codeVerifier || (extraData?._qoderVerifier as string);
    if (!nonce || !verifier) {
      return {
        ok: false,
        data: { error: "invalid_request", error_description: "Missing nonce/verifier" },
      };
    }
    let result: { status: string; accessToken: string; refreshToken: string; expireTime: number; userId: string };
    try {
      result = await svc.pollDeviceToken({ nonce, codeVerifier: verifier });
    } catch (err: unknown) {
      return {
        ok: false,
        data: { error: "poll_failed", error_description: (err as Error).message },
      };
    }
    if (result.status === "pending") {
      return { ok: false, data: { error: "authorization_pending" } };
    }
    const userInfo: { name: string; email: string; organizationId: string } = await svc.fetchUserInfo(result.accessToken);
    const minSeconds: number = 24 * 60 * 60;
    const remainingSeconds: number = Math.floor((result.expireTime - Date.now()) / 1000);
    const expiresIn: number = Math.max(minSeconds, remainingSeconds);
    return {
      ok: true,
      data: {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        expires_in: expiresIn,
        _qoderUserId: result.userId,
        _qoderMachineId: extraData?._qoderMachineId || "",
        _qoderName: userInfo.name,
        _qoderEmail: userInfo.email,
        _qoderOrganizationId: userInfo.organizationId,
      },
    };
  },
  mapTokens: (tokens: Record<string, unknown>): MappedTokens => {
    const rawEmail: string = ((tokens._qoderEmail as string) || "").trim();
    const displayName: string | null = ((tokens._qoderName as string) || "").trim() || null;
    const userId: string = (tokens._qoderUserId as string) || "";
    const email: string | null = rawEmail || (userId ? `qoder-user-${userId}` : null);
    return {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || null,
      expiresIn: tokens.expires_in as number,
      email,
      displayName,
      providerSpecificData: {
        authMethod: "device",
        userId,
        machineId: (tokens._qoderMachineId as string) || "",
        organizationId: (tokens._qoderOrganizationId as string) || "",
      },
    };
  },
};

export default qoder;
