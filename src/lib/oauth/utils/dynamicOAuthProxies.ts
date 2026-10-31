import { TEST_STATUS_ON_CREDENTIAL_ACQUIRED } from "@/lib/db/repos/connectionsRepo";
import http from "http";
import { URL } from "url";
import { ZED_HOSTED_CONFIG } from "../constants/oauth";
import { isLoopbackOrigin, renderCodexResultPage } from "./oauthProxyHtml";

interface DynamicProxyResult {
  success: boolean;
  port?: number;
  callbackUrl?: string;
  reason?: string;
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

export function startZedProxy(preferredPort: number = 0): Promise<DynamicProxyResult> {
  return new Promise<DynamicProxyResult>((resolve: (value: DynamicProxyResult) => void) => {
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
          testStatus: TEST_STATUS_ON_CREDENTIAL_ACQUIRED,
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


