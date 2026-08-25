import { err } from "../logger";
import { fetchRouter, pipeSSE } from "./base";
import type http from "http";

// Map Copilot endpoint → 9Router path
const URL_MAP: Record<string, string> = {
  "/chat/completions": "/v1/chat/completions",
  "/v1/messages":      "/v1/messages",
  "/responses":        "/v1/responses",
};

function resolveRouterPath(reqUrl: string): string {
  for (const [pattern, routerPath] of Object.entries(URL_MAP)) {
    if (reqUrl.includes(pattern)) return routerPath;
  }
  return "/v1/chat/completions";
}

/**
 * Intercept Copilot request — replace model and forward to matching 9Router endpoint
 */
async function intercept(req: http.IncomingMessage, res: http.ServerResponse, bodyBuffer: Buffer, mappedModel: string): Promise<void> {
  try {
    const body: Record<string, any> = JSON.parse(bodyBuffer.toString());
    body.model = mappedModel;
    const routerPath: string = resolveRouterPath(req.url || "");
    const routerRes: Response = await fetchRouter(body, routerPath, req.headers as Record<string, string | string[] | undefined>);
    await pipeSSE(routerRes, res);
  } catch (error: any) {
    err(`[copilot] ${error.message}`);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: error.message, type: "mitm_error" } }));
  }
}

export { intercept };
