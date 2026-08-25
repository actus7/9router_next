import { err, createResponseDumper } from "../logger";
import { IS_DEV } from "../config";
import { fetchRouter, pipeSSE } from "./base";
import type http from "http";

/**
 * Intercept Antigravity request — forward Gemini body as-is to /v1/chat/completions.
 * Router auto-detects format via body.userAgent==="antigravity" + body.request.contents,
 * runs antigravity→openai→provider→openai→antigravity translators internally.
 */
async function intercept(req: http.IncomingMessage, res: http.ServerResponse, bodyBuffer: Buffer, mappedModel: string): Promise<void> {
  const dumper = IS_DEV ? createResponseDumper(req, "intercept-antigravity") : null;
  const isStream: boolean = (req.url || "").includes(":streamGenerateContent");
  try {
    const body: Record<string, any> = JSON.parse(bodyBuffer.toString());
    if (body.model) body.model = mappedModel;

    const routerRes: Response = await fetchRouter(body, "/v1/chat/completions", req.headers as Record<string, string | string[] | undefined>);
    await pipeSSE(routerRes, res, dumper);
  } catch (error: any) {
    err(`[antigravity] ${error.message}`);
    if (dumper) { dumper.writeChunk(`\n[ERROR] ${error.message}\n`); dumper.end(); }
    // For stream endpoint, send SSE error chunk so SDK doesn't hang waiting
    if (isStream) {
      if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ error: { message: error.message } })}\r\n\r\n`);
    } else {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.message, type: "mitm_error" } }));
    }
  }
}

export { intercept };
