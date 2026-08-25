import {
  QODER_DEVICE_TOKEN_URL,
  QODER_LOGIN_URL,
  QODER_USERINFO_URL,
} from "../../qoder/constants";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

const FETCH_TIMEOUT_MS: number = 15_000;

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller: AbortController = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface DeviceFlowResult {
  verificationUriComplete: string;
  codeVerifier: string;
  nonce: string;
  machineId: string;
}

interface PollDeviceTokenResult {
  status: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  expireTime: number;
  rawResponse: Record<string, unknown>;
}

interface UserInfo {
  name: string;
  email: string;
  organizationId?: string;
}

/**
 * Qoder OAuth Service
 * Implements the device-token flow
 */
export class QoderService {
  /**
   * Generate a PKCE verifier + S256 challenge pair.
   */
  generatePkcePair(): { verifier: string; challenge: string } {
    const verifier: string = base64Url(crypto.randomBytes(32));
    const challenge: string = base64Url(crypto.createHash("sha256").update(verifier).digest());
    return { verifier, challenge };
  }

  /**
   * Initiate the device flow.
   */
  initiateDeviceFlow(): DeviceFlowResult {
    const { verifier, challenge } = this.generatePkcePair();
    const nonce: string = uuidv4();
    const machineId: string = uuidv4();

    const params: URLSearchParams = new URLSearchParams({
      challenge,
      challenge_method: "S256",
      machine_id: machineId,
      nonce,
    });

    return {
      verificationUriComplete: `${QODER_LOGIN_URL}?${params.toString()}`,
      codeVerifier: verifier,
      nonce,
      machineId,
    };
  }

  /**
   * Single poll attempt.
   */
  async pollDeviceToken({ nonce, codeVerifier }: { nonce: string; codeVerifier: string }): Promise<PollDeviceTokenResult> {
    if (!nonce || !codeVerifier) {
      throw new Error("pollDeviceToken: missing nonce or code verifier");
    }
    const url: string = `${QODER_DEVICE_TOKEN_URL}?nonce=${encodeURIComponent(nonce)}&verifier=${encodeURIComponent(codeVerifier)}&challenge_method=S256`;

    const response: Response = await fetchWithTimeout(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Go-http-client/2.0",
      },
    });

    if (response.status === 202 || response.status === 404) {
      return { status: "pending", accessToken: "", refreshToken: "", userId: "", expireTime: 0, rawResponse: {} };
    }

    const text: string = await response.text();

    if (!response.ok) {
      let message: string = `Qoder device token poll failed: HTTP ${response.status}`;
      try {
        const body: Record<string, unknown> = JSON.parse(text);
        if (body.message) message = `Qoder device token poll failed: ${body.message}`;
      } catch {}
      throw new Error(message);
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch (err: unknown) {
      throw new Error(`Qoder device token poll: invalid JSON response (${(err as Error).message})`);
    }

    if (!body.token) {
      throw new Error("Qoder device token poll returned 200 but no token");
    }

    const expireMs: number = QoderService.parseExpiry(body.expires_at, body.expires_in);

    return {
      status: "ok",
      accessToken: body.token as string,
      refreshToken: (body.refresh_token as string) || "",
      userId: (body.user_id as string) || "",
      expireTime: expireMs,
      rawResponse: body,
    };
  }

  /**
   * Fetch profile info for the freshly-issued token.
   */
  async fetchUserInfo(accessToken: string): Promise<UserInfo> {
    try {
      const response: Response = await fetchWithTimeout(QODER_USERINFO_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": "Go-http-client/2.0",
        },
      });
      if (!response.ok) return { name: "", email: "" };
      const body: Record<string, unknown> = await response.json();
      return {
        name: ((body.name as string) || (body.username as string) || "").trim(),
        email: ((body.email as string) || "").trim(),
        organizationId: ((body.organization_id as string) || "").trim(),
      };
    } catch {
      return { name: "", email: "" };
    }
  }

  /**
   * Convert the upstream's expiry hint into a Unix-millisecond timestamp.
   */
  static parseExpiry(expiresAt: unknown, expiresInSeconds: unknown): number {
    if (typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > 0) {
      return expiresAt;
    }
    const trimmed: string = typeof expiresAt === "string" ? expiresAt.trim() : "";
    if (trimmed) {
      if (/^\d+$/.test(trimmed)) {
        const ms: number = Number.parseInt(trimmed, 10);
        if (Number.isFinite(ms) && ms > 0) return ms;
      }
      const parsed: number = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) return parsed;
    }
    if (typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds) && expiresInSeconds >= 0) {
      return Date.now() + expiresInSeconds * 1000;
    }
    return Date.now() + 30 * 24 * 60 * 60 * 1000;
  }
}
