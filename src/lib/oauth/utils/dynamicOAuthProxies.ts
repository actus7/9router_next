import http from "http";
import { URL } from "url";
import { TRAE_CONFIG, WINDSURF_CONFIG, ZED_HOSTED_CONFIG } from "../constants/oauth";
import { isLoopbackOrigin, renderCodexResultPage } from "./oauthProxyHtml";

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
        const tokenData: Record<string, unknown> = await exchangeTokens("trae", rawCallback, "", "", "");
        const connection = await createProviderConnection({
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
        const tokenData: Record<string, unknown> = await exchangeTokens("windsurf", rawCallback, "", "", session.state);
        const connection = await createProviderConnection({
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
        const tokenData: Record<string, unknown> = await exchangeTokens("zed", rawCallback, "", session.codeVerifier, session.state);
        const connection = await createProviderConnection({
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
        console.error(`[Zed proxy] port ${tryPort} busy, falling back to random`);
        server.listen(0, "127.0.0.1", () => {
          zedProxyServer = server;
          zedProxyPort = (server.address() as { port: number }).port;
          zedProxyTimeout = setTimeout(() => stopZedProxy(), (ZED_HOSTED_CONFIG as Record<string, number>).oauthTimeoutMs);
          console.error(`[Zed proxy] listening on random port ${zedProxyPort}`);
          resolve({ success: true, port: zedProxyPort, callbackUrl: `http://127.0.0.1:${zedProxyPort}/` });
        });
      } else {
        console.error(`[Zed proxy] listen error: ${err.message}`);
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


