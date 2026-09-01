import http from "http";
import { URL } from "url";
import { CODEX_CONFIG } from "../constants/oauth";
import { renderCodexResultPage } from "./oauthProxyHtml";

// Singleton proxy server for Codex OAuth callback on fixed port
let codexProxyServer: http.Server | null = null;
let codexProxyTimeout: ReturnType<typeof setTimeout> | null = null;

const CODEX_PROXY_TIMEOUT_MS: number = 300000; // 5 minutes
const CODEX_PORT: number = (CODEX_CONFIG as Record<string, number>).fixedPort;

interface PendingExchange {
  codeVerifier: string;
  redirectUri: string;
  status: string;
  createdAt: number;
  connectionId?: string;
  email?: string;
  error?: string;
}

const pendingExchanges: Map<string, PendingExchange> = new Map();

export function registerCodexSession({ state, codeVerifier, redirectUri }: { state: string; codeVerifier: string; redirectUri: string }): boolean {
  if (!state || !codeVerifier || !redirectUri) return false;
  pendingExchanges.set(state, {
    codeVerifier,
    redirectUri,
    status: "pending",
    createdAt: Date.now(),
  });
  return true;
}

export function getCodexSessionStatus(state: string): PendingExchange | null {
  return pendingExchanges.get(state) || null;
}

export function clearCodexSession(state: string): void {
  pendingExchanges.delete(state);
}

interface ProxyResult {
  success: boolean;
  reason?: string;
}

export function startCodexProxy(appPort: number): Promise<ProxyResult> {
  return new Promise<ProxyResult>((resolve: (value: ProxyResult) => void) => {
    if (codexProxyServer) {
      resolve({ success: true });
      return;
    }

    const server: http.Server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url: URL = new URL(req.url!, "http://localhost");

      if (url.pathname !== "/callback" && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code: string | null = url.searchParams.get("code");
      const state: string | null = url.searchParams.get("state");
      const errorParam: string | null = url.searchParams.get("error");
      const session: PendingExchange | undefined = state ? pendingExchanges.get(state) : undefined;

      if (session) {
        try {
          if (errorParam) {
            throw new Error(url.searchParams.get("error_description") || errorParam);
          }
          if (!code) throw new Error("No authorization code received");

          const { exchangeTokens } = await import("../providers");
          const { createProviderConnection } = await import("@/models");

          const tokenData: Record<string, unknown> = await exchangeTokens(
            "codex",
            code,
            session.redirectUri,
            session.codeVerifier,
            state!
          );
          const connection = await createProviderConnection({
            provider: "codex",
            authType: "oauth",
            ...tokenData,
            expiresAt: (tokenData as Record<string, number>).expiresIn
              ? new Date(Date.now() + (tokenData as Record<string, number>).expiresIn * 1000).toISOString()
              : null,
            testStatus: "active",
          }) as Record<string, unknown>;

          session.status = "done";
          session.connectionId = (connection as Record<string, string>).id;
          session.email = (connection as Record<string, string>).email;

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCodexResultPage(true, "You can close this window."));
        } catch (err: unknown) {
          session.status = "error";
          session.error = (err as Error).message;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCodexResultPage(false, (err as Error).message));
        } finally {
          stopCodexProxy();
        }
        return;
      }

      const redirectUrl: string = `http://localhost:${appPort}/callback${url.search}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      stopCodexProxy();
    });

    server.listen(CODEX_PORT, "127.0.0.1", () => {
      codexProxyServer = server;
      codexProxyTimeout = setTimeout(() => stopCodexProxy(), CODEX_PROXY_TIMEOUT_MS);
      resolve({ success: true });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve({ success: false, reason: "port_busy" });
      } else {
        resolve({ success: false, reason: err.message });
      }
    });
  });
}

export function stopCodexProxy(): void {
  if (codexProxyTimeout) {
    clearTimeout(codexProxyTimeout);
    codexProxyTimeout = null;
  }
  if (codexProxyServer) {
    codexProxyServer.close();
    codexProxyServer = null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// xAI fixed-port proxy on 127.0.0.1:56121
// ───────────────────────────────────────────────────────────────────────────

let xaiProxyServer: http.Server | null = null;
let xaiProxyTimeout: ReturnType<typeof setTimeout> | null = null;
const XAI_PROXY_TIMEOUT_MS: number = 300000; // 5 minutes
const XAI_PROXY_PORT: number = 56121;
const xaiPendingExchanges: Map<string, PendingExchange> = new Map();

export function registerXaiSession({ state, codeVerifier, redirectUri }: { state: string; codeVerifier: string; redirectUri: string }): boolean {
  if (!state || !codeVerifier || !redirectUri) return false;
  xaiPendingExchanges.set(state, {
    codeVerifier,
    redirectUri,
    status: "pending",
    createdAt: Date.now(),
  });
  return true;
}

export function getXaiSessionStatus(state: string): PendingExchange | null {
  return xaiPendingExchanges.get(state) || null;
}

export function clearXaiSession(state: string): void {
  xaiPendingExchanges.delete(state);
}

function renderXaiResultPage(success: boolean, message: string): string {
  return renderCodexResultPage(success, message);
}

export function startXaiProxy(appPort: number): Promise<ProxyResult> {
  return new Promise<ProxyResult>((resolve: (value: ProxyResult) => void) => {
    if (xaiProxyServer) {
      resolve({ success: true });
      return;
    }

    const server: http.Server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url: URL = new URL(req.url!, "http://localhost");
      if (url.pathname !== "/callback" && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code: string | null = url.searchParams.get("code");
      const state: string | null = url.searchParams.get("state");
      const errorParam: string | null = url.searchParams.get("error");
      const session: PendingExchange | undefined = state ? xaiPendingExchanges.get(state) : undefined;

      if (session) {
        try {
          if (errorParam) {
            throw new Error(url.searchParams.get("error_description") || errorParam);
          }
          if (!code) throw new Error("No authorization code received");

          const { exchangeTokens } = await import("../providers");
          const { createProviderConnection } = await import("@/models");

          const tokenData: Record<string, unknown> = await exchangeTokens(
            "xai",
            code,
            session.redirectUri,
            session.codeVerifier,
            state!
          );
          const connection = await createProviderConnection({
            provider: "xai",
            authType: "oauth",
            ...tokenData,
            expiresAt: (tokenData as Record<string, number>).expiresIn
              ? new Date(Date.now() + (tokenData as Record<string, number>).expiresIn * 1000).toISOString()
              : null,
            testStatus: "active",
          });

          session.status = "done";
          session.connectionId = (connection as Record<string, string>).id;
          session.email = (connection as Record<string, string>).email;

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderXaiResultPage(true, "You can close this window."));
        } catch (err: unknown) {
          session.status = "error";
          session.error = (err as Error).message;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderXaiResultPage(false, (err as Error).message));
        } finally {
          stopXaiProxy();
        }
        return;
      }

      const redirectUrl: string = `http://localhost:${appPort}/callback${url.search}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      stopXaiProxy();
    });

    server.listen(XAI_PROXY_PORT, "127.0.0.1", () => {
      xaiProxyServer = server;
      xaiProxyTimeout = setTimeout(() => stopXaiProxy(), XAI_PROXY_TIMEOUT_MS);
      resolve({ success: true });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve({ success: false, reason: "port_busy" });
      } else {
        resolve({ success: false, reason: err.message });
      }
    });
  });
}

export function stopXaiProxy(): void {
  if (xaiProxyTimeout) {
    clearTimeout(xaiProxyTimeout);
    xaiProxyTimeout = null;
  }
  if (xaiProxyServer) {
    xaiProxyServer.close();
    xaiProxyServer = null;
  }
}

// ───────────────────────────────────────────────────────────────────────────

