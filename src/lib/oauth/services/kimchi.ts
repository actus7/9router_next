// Kimchi browser-login service.
import { randomBytes } from "node:crypto";
import { startLocalServer } from "../utils/server";
import { KIMCHI_CONFIG } from "../constants/oauth";

interface Session {
  result: Promise<Record<string, unknown>>;
  close: () => void;
  timeout: ReturnType<typeof setTimeout>;
  done: boolean;
  resolved: Record<string, unknown> | null;
}

const sessions: Map<string, Session> = new Map();
const SESSION_TTL_MS: number = 5 * 60 * 1000;

export function buildKimchiAuthUrl(callbackUrl: string, state: string): string {
  const params: URLSearchParams = new URLSearchParams({ callback: callbackUrl, state });
  return `${(KIMCHI_CONFIG as Record<string, string>).webAppUrl}/cli-auth?${params.toString()}`;
}

export function generateState(): string {
  return randomBytes(32).toString("hex");
}

export function getResolvedSession(state: string): Record<string, unknown> | null {
  const s: Session | undefined = sessions.get(state);
  if (!s || !s.done || !s.resolved) return null;
  return s.resolved;
}

export class KimchiService {
  async startLogin(): Promise<{ authUrl: string; port: number; state: string; result: Promise<Record<string, unknown>>; close: () => void }> {
    const state: string = generateState();
    let resolveResult: (value: Record<string, unknown>) => void;
    const result: Promise<Record<string, unknown>> = new Promise<Record<string, unknown>>((resolve: (value: Record<string, unknown>) => void) => { resolveResult = resolve; });

    const { port, close } = await startLocalServer((params: Record<string, string>) => {
      this._handleCallback(params, state)
        .then(resolveResult)
        .catch((err: Error) => resolveResult({ error: err.message }));
    });

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      resolveResult({ error: "Browser login timed out — please try again" });
      close();
    }, (KIMCHI_CONFIG as Record<string, number>).callbackTimeoutMs);

    sessions.set(state, { result, close, timeout, done: false, resolved: null });

    result.then((r: Record<string, unknown>) => {
      const s: Session | undefined = sessions.get(state);
      if (!s) return;
      s.done = true;
      s.resolved = r;
      clearTimeout(s.timeout);
      try { s.close(); } catch { /* already closed */ }
      setTimeout(() => sessions.delete(state), SESSION_TTL_MS).unref?.();
    });

    const callbackUrl: string = `http://127.0.0.1:${port}${(KIMCHI_CONFIG as Record<string, string>).callbackPath}`;
    const authUrl: string = buildKimchiAuthUrl(callbackUrl, state);
    return { authUrl, port, state, result, close };
  }

  async _handleCallback(params: Record<string, string>, expectedState: string): Promise<{ token: string }> {
    if (params.error) {
      throw new Error(params.error_description || params.error);
    }
    const candidate: string = params.state;
    if (!candidate || candidate !== expectedState) {
      throw new Error("This request isn't valid. Please restart the Kimchi login flow.");
    }
    const token: string = params.token;
    if (!token) {
      throw new Error("No token was returned by the Kimchi authentication server");
    }
    const check: { valid: boolean; error?: string } = await this.validateToken(token);
    if (!check.valid) {
      throw new Error(check.error || "Kimchi token validation failed");
    }
    return { token };
  }

  async fetchProfile(token: string): Promise<{ displayName?: string; email?: string; username?: string }> {
    try {
      const res: Response = await fetch((KIMCHI_CONFIG as Record<string, string>).meUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return {};
      const j: Record<string, unknown> = await res.json();
      return { displayName: j.name as string, email: j.email as string, username: j.username as string };
    } catch {
      return {};
    }
  }

  async validateToken(token: string): Promise<{ valid: boolean; error?: string }> {
    const controller: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), 10_000);
    let status: number = 0;
    try {
      const res: Response = await fetch((KIMCHI_CONFIG as Record<string, string>).validationUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      status = res.status;
    } catch {
      return { valid: true };
    } finally {
      clearTimeout(timer);
    }
    if (status === 200) return { valid: true };
    if (status === 401) return { valid: false, error: "Kimchi token invalid or expired" };
    if (status === 403) return { valid: false, error: "Kimchi token lacks required scope" };
    return { valid: true };
  }
}
