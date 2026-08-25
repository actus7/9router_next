import { log, err } from "../logger";
import type http from "http";

const DEFAULT_LOCAL_ROUTER: string = "http://localhost:20128";
const ROUTER_BASE: string = String(process.env.MITM_ROUTER_BASE || DEFAULT_LOCAL_ROUTER)
  .trim()
  .replace(/\/+$/, "") || DEFAULT_LOCAL_ROUTER;
const API_KEY: string | undefined = process.env.ROUTER_API_KEY;

// Headers that must not be forwarded to 9Router
const STRIP_HEADERS: Set<string> = new Set([
  "host", "content-length", "connection", "transfer-encoding",
  "content-type", "authorization"
]);

interface ResponseDumper {
  writeHeader: (status: number, headers: Record<string, string | string[] | undefined>) => void;
  writeChunk: (chunk: Buffer | string | null | undefined) => void;
  end: () => void;
  file: string;
}

/**
 * Send body to 9Router at the given path and return the fetch Response object.
 * Optionally forwards client headers (stripped of hop-by-hop / overridden keys).
 */
async function fetchRouter(openaiBody: Record<string, unknown>, path: string = "/v1/chat/completions", clientHeaders: Record<string, string | string[] | undefined> = {}): Promise<Response> {
  const forwarded: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(clientHeaders)) {
    if (!STRIP_HEADERS.has(k.toLowerCase())) forwarded[k] = v;
  }

  const response: Response = await fetch(`${ROUTER_BASE}${path}`, {
    method: "POST",
    headers: {
      ...forwarded,
      "Content-Type": "application/json",
      ...(API_KEY && { "Authorization": `Bearer ${API_KEY}` })
    } as Record<string, string>,
    body: JSON.stringify(openaiBody)
  });

  // Forward response as-is (status + body). pipeSSE will propagate status.
  return response;
}

/**
 * Pipe SSE stream from router directly to client response.
 * Optional dumper tees the stream into a debug file.
 */
async function pipeSSE(routerRes: Response, res: http.ServerResponse, dumper?: ResponseDumper | null): Promise<void> {
  const ct: string = routerRes.headers.get("content-type") || "application/json";
  const status: number = routerRes.status || 200;
  const resHeaders: Record<string, string> = { "Content-Type": ct, "Cache-Control": "no-cache", "Connection": "keep-alive" };
  if (ct.includes("text/event-stream")) resHeaders["X-Accel-Buffering"] = "no";
  res.writeHead(status, resHeaders);
  if (dumper) dumper.writeHeader(routerRes.status, Object.fromEntries(routerRes.headers));

  if (!routerRes.body) {
    const text: string = await routerRes.text().catch(() => "");
    if (dumper) { dumper.writeChunk(text); dumper.end(); }
    res.end(text);
    return;
  }

  const reader = routerRes.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) { if (dumper) dumper.end(); res.end(); break; }
    if (dumper) dumper.writeChunk(value);
    res.write(decoder.decode(value, { stream: true }));
  }
}

/**
 * Pipe SSE stream from router, transforming each chunk through a user function.
 * Reads SSE data: lines, parses JSON, calls transformFn(parsed, state),
 * and writes returned SSE strings to the client response.
 */
async function pipeTransformedSSE(
  routerRes: Response,
  res: http.ServerResponse,
  transformFn: (parsedChunk: Record<string, unknown> | null, state: Record<string, unknown>) => string | string[] | null,
  state: Record<string, unknown>
): Promise<void> {
  const ct: string = routerRes.headers.get("content-type") || "application/json";
  const resHeaders: Record<string, string> = { "Content-Type": ct, "Cache-Control": "no-cache", "Connection": "keep-alive" };
  if (ct.includes("text/event-stream")) resHeaders["X-Accel-Buffering"] = "no";
  res.writeHead(200, resHeaders);

  if (!routerRes.body) {
    res.end(await routerRes.text().catch(() => ""));
    return;
  }

  const reader = routerRes.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer: string = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines: string[] = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed: string = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const data: string = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;

      if (process.env.DEBUG_MITM) {
        log(`[SSE in] ${data.slice(0, 200)}`);
      }

      try {
        const parsed: Record<string, unknown> = JSON.parse(data);
        const result = transformFn(parsed, state);
        if (result != null) {
          const outputs: (string | Uint8Array)[] = Array.isArray(result) ? result : [result];
          for (const output of outputs) {
            if (process.env.DEBUG_MITM) {
              const len: number = (output as any).length || (output as any).byteLength || 0;
              log(`[write binary frame] (${len}B) first 20B: ${Array.from((output as Uint8Array).slice(0, 20)).join(',')}`);
            }
            res.write(Buffer.from(output as any));
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  // Flush: pass null to signal stream end
  try {
    const flushed = transformFn(null, state);
    if (flushed != null) {
      const outputs: string[] = Array.isArray(flushed) ? flushed : [flushed];
      for (const output of outputs) {
        res.write(output);
      }
    }
  } catch { /* ignore flush errors */ }

  res.end();
}

/**
 * Pipe SSE stream from router, transforming each chunk through a user function,
 * and writing binary EventStream frames to the client.
 */
async function pipeTransformedEventStream(
  routerRes: Response,
  res: http.ServerResponse,
  transformFn: (parsedChunk: Record<string, unknown> | null, state: Record<string, unknown>) => Uint8Array | Uint8Array[] | null,
  state: Record<string, unknown>
): Promise<void> {
  const resHeaders: Record<string, string> = {
    "Content-Type": "application/vnd.amazon.eventstream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  };
  res.writeHead(200, resHeaders);

  if (!routerRes.body) {
    res.end(await routerRes.text().catch(() => ""));
    return;
  }

  const reader = routerRes.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer: string = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines: string[] = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed: string = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const data: string = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;

      if (process.env.DEBUG_MITM) {
        log(`[SSE in] ${data.slice(0, 200)}`);
      }

      try {
        const parsed: Record<string, unknown> = JSON.parse(data);
        const result = transformFn(parsed, state);
        if (result != null) {
          const outputs: Uint8Array[] = Array.isArray(result) ? result : [result];
          for (const output of outputs) {
            if (process.env.DEBUG_MITM) {
              const len: number = output.length || output.byteLength || 0;
              log(`[write binary frame] (${len}B) first 20B: ${Array.from(output.slice(0, 20)).join(',')}`);
            }
            res.write(Buffer.from(output));
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  // Flush: pass null to signal stream end
  try {
    const flushed = transformFn(null, state);
    if (flushed != null) {
      const outputs: Uint8Array[] = Array.isArray(flushed) ? flushed : [flushed];
      for (const output of outputs) {
        res.write(output);
      }
    }
  } catch { /* ignore flush errors */ }

  res.end();
}

export { fetchRouter, pipeSSE, pipeTransformedSSE, pipeTransformedEventStream };
