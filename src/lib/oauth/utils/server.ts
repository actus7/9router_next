import http from "http";
import { URL } from "url";
import { CODEX_CONFIG, TRAE_CONFIG, WINDSURF_CONFIG, ZED_HOSTED_CONFIG } from "../constants/oauth";

// Loopback origin guard for local callback proxies.
function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // navigation redirect — allow
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

interface LocalServerResult {
  server: http.Server;
  port: number;
  close: () => void;
}

/**
 * Start a local HTTP server to receive OAuth callback
 */
export function startLocalServer(onCallback: (params: Record<string, string>) => void, fixedPort: number | null = null): Promise<LocalServerResult> {
  return new Promise<LocalServerResult>((resolve: (value: LocalServerResult) => void, reject: (reason: Error) => void) => {
    const server: http.Server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
      const url: URL = new URL(req.url!, `http://localhost`);

      if (url.pathname === "/callback" || url.pathname === "/auth/callback") {
        const params: Record<string, string> = Object.fromEntries(url.searchParams);

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Successful</title>
  <style>
    body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .success { color: #22c55e; font-size: 3rem; }
    h1 { margin: 1rem 0; }
    p { color: #666; }
    #countdown { font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success">&#10003;</div>
    <h1>Authentication Successful</h1>
    <p id="message">Closing in <span id="countdown">3</span> seconds...</p>
  </div>
  <script>
    let count = 3;
    const countdown = document.getElementById("countdown");
    const message = document.getElementById("message");
    const timer = setInterval(() => {
      count--;
      countdown.textContent = count;
      if (count <= 0) {
        clearInterval(timer);
        window.close();
        setTimeout(() => {
          message.textContent = "Please close this tab manually.";
        }, 500);
      }
    }, 1000);
  </script>
</body>
</html>`);

        onCallback(params);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    const portToUse: number = fixedPort || 0;
    server.listen(portToUse, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({
        server,
        port,
        close: () => server.close(),
      });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && fixedPort) {
        reject(new Error(`Port ${fixedPort} is already in use. Please close other applications using this port.`));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Wait for callback with timeout
 */
function waitForCallback(timeoutMs: number = 300000): Promise<Record<string, string>> {
  return new Promise<Record<string, string>>((resolve: (value: Record<string, string>) => void, reject: (reason: Error) => void) => {
    let resolved: boolean = false;

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("Authentication timeout"));
      }
    }, timeoutMs);

    const onCallback = (params: Record<string, string>): void => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(params);
      }
    };

    (resolve as any).__onCallback = onCallback;
  });
}

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

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCodexResultPage(success: boolean, message: string): string {
  const color: string = success ? "#22c55e" : "#ef4444";
  const icon: string = success ? "&#10003;" : "&#10007;";
  const title: string = success ? "Authentication Successful" : "Authentication Failed";
  const safeMessage: string = escapeHtml(message);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}.c{text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.i{color:${color};font-size:3rem}h1{margin:1rem 0}p{color:#666}</style>
</head><body><div class="c"><div class="i">${icon}</div><h1>${title}</h1><p>${safeMessage}</p><p>Closing in <span id="cd">3</span>s...</p>
<script>let n=3;const c=document.getElementById("cd");const t=setInterval(()=>{n--;c.textContent=n;if(n<=0){clearInterval(t);window.close();}},1000);</script>
</div></body></html>`;
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
          const connection: Record<string, unknown> = await createProviderConnection({
            provider: "codex",
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
          const connection: Record<string, unknown> = await createProviderConnection({
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
// Trae dynamic-port proxy. Singleton session.
// ───────────────────────────────────────────────────────────────────────────

let traeProxyServer: http.Server | null = null;
let traeProxyTimeout: ReturnType<typeof setTimeout> | null = null;
let traeProxyPort: number | null = null;
let traeSession: { state: string; status: string; createdAt: number; connectionId?: string; email?: string; error?: string } | null = null;

export function registerTraeSession({ state }: { state: string }): boolean {
  if (!state) return false;
  traeSession = { state, status: "pending", createdAt: Date.now() };
  return true;
}
export function getTraeSessionStatus(state?: string): typeof traeSession {
  if (!traeSession) return null;
  if (state && traeSession.state !== state) return null;
  return traeSession;
}
export function clearTraeSession(state?: string): void {
  if (!state || (traeSession && traeSession.state === state)) traeSession = null;
}

interface TraeProxyResult {
  success: boolean;
  port?: number;
  callbackUrl?: string;
  reason?: string;
}

export function startTraeProxy(): Promise<TraeProxyResult> {
  return new Promise<TraeProxyResult>((resolve: (value: TraeProxyResult) => void) => {
    if (traeProxyServer) {
      resolve({ success: true, port: traeProxyPort!, callbackUrl: `http://127.0.0.1:${traeProxyPort}${(TRAE_CONFIG as Record<string, string>).callbackPath}` });
      return;
    }
    const server: http.Server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url: URL = new URL(req.url!, "http://localhost");
      if (url.pathname !== (TRAE_CONFIG as Record<string, string>).callbackPath && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const session = traeSession;
      if (!session) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "No active Trae login session"));
        return;
      }
      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "Cross-origin callback rejected"));
        return;
      }
      const cbState: string | null = url.searchParams.get("state");
      if (cbState && session.state && cbState !== session.state) {
        session.status = "error";
        session.error = "Trae callback state mismatch";
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, session.error));
        stopTraeProxy();
        return;
      }
      const rawCallback: string = `${url.pathname}?${url.searchParams.toString()}`;
      try {
        const { exchangeTokens } = await import("../providers");
        const { createProviderConnection } = await import("@/models");
        const tokenData: Record<string, unknown> = await exchangeTokens("trae", rawCallback);
        const connection: Record<string, unknown> = await createProviderConnection({
          provider: "trae",
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
        res.end(renderCodexResultPage(true, "You can close this window."));
      } catch (err: unknown) {
        session.status = "error";
        session.error = (err as Error).message;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, (err as Error).message));
      } finally {
        stopTraeProxy();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      traeProxyServer = server;
      traeProxyPort = (server.address() as { port: number }).port;
      traeProxyTimeout = setTimeout(() => stopTraeProxy(), (TRAE_CONFIG as Record<string, number>).oauthTimeoutMs);
      resolve({ success: true, port: traeProxyPort, callbackUrl: `http://127.0.0.1:${traeProxyPort}${(TRAE_CONFIG as Record<string, string>).callbackPath}` });
    });
    server.on("error", (err: Error) => resolve({ success: false, reason: err.message }));
  });
}

export function stopTraeProxy(): void {
  if (traeProxyTimeout) { clearTimeout(traeProxyTimeout); traeProxyTimeout = null; }
  if (traeProxyServer) { traeProxyServer.close(); traeProxyServer = null; }
  traeProxyPort = null;
}

// ───────────────────────────────────────────────────────────────────────────
// Windsurf dynamic-port proxy. Singleton session.
// ───────────────────────────────────────────────────────────────────────────

let windsurfProxyServer: http.Server | null = null;
let windsurfProxyTimeout: ReturnType<typeof setTimeout> | null = null;
let windsurfProxyPort: number | null = null;
let windsurfSession: { state: string; status: string; createdAt: number; connectionId?: string; email?: string; error?: string } | null = null;

export function registerWindsurfSession({ state }: { state: string }): boolean {
  if (!state) return false;
  windsurfSession = { state, status: "pending", createdAt: Date.now() };
  return true;
}
export function getWindsurfSessionStatus(state?: string): typeof windsurfSession {
  if (!windsurfSession) return null;
  if (state && windsurfSession.state !== state) return null;
  return windsurfSession;
}
export function clearWindsurfSession(state?: string): void {
  if (!state || (windsurfSession && windsurfSession.state === state)) windsurfSession = null;
}

export function startWindsurfProxy(): Promise<TraeProxyResult> {
  return new Promise<TraeProxyResult>((resolve: (value: TraeProxyResult) => void) => {
    if (windsurfProxyServer) {
      resolve({ success: true, port: windsurfProxyPort!, callbackUrl: `http://127.0.0.1:${windsurfProxyPort}${(WINDSURF_CONFIG as Record<string, string>).callbackPath}` });
      return;
    }
    const server: http.Server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url: URL = new URL(req.url!, "http://localhost");
      if (url.pathname !== (WINDSURF_CONFIG as Record<string, string>).callbackPath) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const session = windsurfSession;
      if (!session) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "No active Windsurf login session"));
        return;
      }
      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "Cross-origin callback rejected"));
        return;
      }
      const cbState: string | null = url.searchParams.get("state");
      if (!cbState || !session.state || cbState !== session.state) {
        session.status = "error";
        session.error = "Windsurf callback state mismatch";
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, session.error));
        stopWindsurfProxy();
        return;
      }
      const rawCallback: string = `${url.pathname}?${url.searchParams.toString()}`;
      try {
        const { exchangeTokens } = await import("../providers");
        const { createProviderConnection } = await import("@/models");
        const tokenData: Record<string, unknown> = await exchangeTokens("windsurf", rawCallback, null, null, session.state);
        const connection: Record<string, unknown> = await createProviderConnection({
          provider: "windsurf",
          authType: "api_key",
          ...tokenData,
          testStatus: "active",
        });
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
        stopWindsurfProxy();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      windsurfProxyServer = server;
      windsurfProxyPort = (server.address() as { port: number }).port;
      windsurfProxyTimeout = setTimeout(() => stopWindsurfProxy(), (WINDSURF_CONFIG as Record<string, number>).oauthTimeoutMs);
      resolve({ success: true, port: windsurfProxyPort, callbackUrl: `http://127.0.0.1:${windsurfProxyPort}${(WINDSURF_CONFIG as Record<string, string>).callbackPath}` });
    });
    server.on("error", (err: Error) => resolve({ success: false, reason: err.message }));
  });
}

export function stopWindsurfProxy(): void {
  if (windsurfProxyTimeout) { clearTimeout(windsurfProxyTimeout); windsurfProxyTimeout = null; }
  if (windsurfProxyServer) { windsurfProxyServer.close(); windsurfProxyServer = null; }
  windsurfProxyPort = null;
}

// ───────────────────────────────────────────────────────────────────────────
// Zed RSA native-app proxy. Singleton session.
// ───────────────────────────────────────────────────────────────────────────

let zedProxyServer: http.Server | null = null;
let zedProxyTimeout: ReturnType<typeof setTimeout> | null = null;
let zedProxyPort: number | null = null;
let zedSession: { state: string; codeVerifier: string; status: string; createdAt: number; connectionId?: string; email?: string; error?: string } | null = null;

export function registerZedSession({ state, codeVerifier }: { state: string; codeVerifier: string }): boolean {
  if (!state || !codeVerifier) return false;
  zedSession = { state, codeVerifier, status: "pending", createdAt: Date.now() };
  return true;
}
export function getZedSessionStatus(state?: string): typeof zedSession {
  if (!zedSession) return null;
  if (state && zedSession.state !== state) return null;
  return zedSession;
}
export function clearZedSession(state?: string): void {
  if (!state || (zedSession && zedSession.state === state)) zedSession = null;
}

export function startZedProxy(preferredPort: number = 0): Promise<TraeProxyResult> {
  return new Promise<TraeProxyResult>((resolve: (value: TraeProxyResult) => void) => {
    if (zedProxyServer) {
      resolve({ success: true, port: zedProxyPort!, callbackUrl: `http://127.0.0.1:${zedProxyPort}/` });
      return;
    }
    const server: http.Server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url: URL = new URL(req.url!, "http://localhost");
      const redacted: Record<string, string> = Object.fromEntries(url.searchParams);
      for (const k of ["access_token", "user_id", "code_verifier", "state"]) {
        if (redacted[k]) redacted[k] = "<redacted>";
      }
      console.log("[Zed proxy]", req.method, url.pathname, JSON.stringify(redacted));
      if (url.pathname !== "/" && url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const session = zedSession;
      if (!session) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "No active Zed login session"));
        return;
      }
      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "Cross-origin callback rejected"));
        return;
      }
      const rawCallback: string = url.search ? `${url.pathname}?${url.searchParams.toString()}` : url.pathname;
      try {
        const { exchangeTokens } = await import("../providers");
        const { createProviderConnection } = await import("@/models");
        const tokenData: Record<string, unknown> = await exchangeTokens("zed", rawCallback, null, session.codeVerifier, session.state);
        const connection: Record<string, unknown> = await createProviderConnection({
          provider: "zed",
          authType: "oauth",
          ...tokenData,
          testStatus: "active",
        });
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
        stopZedProxy();
      }
    });
    const tryPort: number = Number(preferredPort) || 0;
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && tryPort !== 0) {
        console.log(`[Zed proxy] port ${tryPort} busy, falling back to random`);
        server.listen(0, "127.0.0.1", () => {
          zedProxyServer = server;
          zedProxyPort = (server.address() as { port: number }).port;
          zedProxyTimeout = setTimeout(() => stopZedProxy(), (ZED_HOSTED_CONFIG as Record<string, number>).oauthTimeoutMs);
          console.log(`[Zed proxy] listening on random port ${zedProxyPort}`);
          resolve({ success: true, port: zedProxyPort, callbackUrl: `http://127.0.0.1:${zedProxyPort}/` });
        });
      } else {
        console.log(`[Zed proxy] listen error: ${err.message}`);
        resolve({ success: false, reason: err.message });
      }
    });
    server.listen(tryPort, "127.0.0.1", () => {
      zedProxyServer = server;
      zedProxyPort = (server.address() as { port: number }).port;
      zedProxyTimeout = setTimeout(() => { console.log("[Zed proxy] timeout, stopping"); stopZedProxy(); }, (ZED_HOSTED_CONFIG as Record<string, number>).oauthTimeoutMs);
      console.log(`[Zed proxy] listening on port ${zedProxyPort}`);
      resolve({ success: true, port: zedProxyPort, callbackUrl: `http://127.0.0.1:${zedProxyPort}/` });
    });
  });
}

export function stopZedProxy(): void {
  console.log(`[Zed proxy] stopping (port ${zedProxyPort || "-"})`);
  if (zedProxyTimeout) { clearTimeout(zedProxyTimeout); zedProxyTimeout = null; }
  if (zedProxyServer) { zedProxyServer.close(); zedProxyServer = null; }
  zedProxyPort = null;
}
