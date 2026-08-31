// Meta AI WS "clippy" chat round-trip: opens the gateway WebSocket, sends the
// intro + prompt frames, and accumulates streamed content/patch events into a
// single result. Ported from OmniRoute's muse-spark-web.ts wsChat().

import { Buffer } from "node:buffer";
import WebSocket from "ws";
import { buildWsIntroFrame, buildWsPromptFrame, buildWsUrl } from "./wsFrames";

const META_AI_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const WS_TIMEOUT_MS = 30000;

type WsResponseEvent = {
  type: "full" | "patch";
  response?: { sections?: Array<{ view_model?: { primitive?: { text?: string } } }> };
  operations?: Array<{ op?: string; path?: string; value?: string }>;
};

/** Scans for top-level `{...}` JSON objects in a WS text frame (the gateway
 * concatenates multiple JSON events per message with no separator). */
function parseWsResponseEvents(payload: string): WsResponseEvent[] {
  const events: WsResponseEvent[] = [];
  let start: number | null = null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload[i];
    if (start === null) {
      if (ch === "{") {
        start = i;
        depth = 1;
        inString = false;
        escape = false;
      }
      continue;
    }
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== null) {
        try {
          events.push(JSON.parse(payload.slice(start, i + 1)));
        } catch {
          /* skip malformed fragment */
        }
        start = null;
      }
    }
  }
  return events;
}

export type WsChatResult = {
  content: string;
  deltas: string[];
  error?: string;
};

export async function wsChat(
  prompt: string,
  conversationId: string,
  authorization: string,
  cookieHeader: string,
  templateB64: string,
  signal?: AbortSignal | null
): Promise<WsChatResult> {
  const requestId = crypto.randomUUID();
  const wsUrl = buildWsUrl(authorization, requestId);

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        Cookie: cookieHeader,
        "User-Agent": META_AI_USER_AGENT,
        Origin: "https://meta.ai",
      },
    });
    let settled = false;
    let accumulatedText = "";
    const contentDeltas: string[] = [];
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let abortHandler: (() => void) | null = null;

    const finish = (result: WsChatResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const fail = (error: string) => finish({ content: "", deltas: [], error });

    timeout = setTimeout(() => fail(`Meta AI WS timed out (readyState=${ws.readyState})`), WS_TIMEOUT_MS);
    abortHandler = () => fail("Request aborted");
    signal?.addEventListener("abort", abortHandler, { once: true });

    ws.onopen = () => {
      ws.send(buildWsIntroFrame(conversationId));
      ws.send(buildWsPromptFrame(prompt, conversationId, { templateB64, requestId }));
    };

    ws.onmessage = (event) => {
      let raw = "";
      if (typeof event.data === "string") {
        raw = event.data;
      } else if (Buffer.isBuffer(event.data)) {
        raw = event.data.toString("utf-8");
      } else if (event.data instanceof ArrayBuffer) {
        raw = new TextDecoder().decode(event.data);
      }
      if (!raw) return;
      const events = parseWsResponseEvents(raw);
      for (const evt of events) {
        if (evt.type === "full") {
          const sections = evt.response?.sections || [];
          for (const section of sections) {
            const text = section?.view_model?.primitive?.text || "";
            if (text && text !== accumulatedText) {
              const delta = accumulatedText ? text.slice(accumulatedText.length) || text : text;
              if (delta) contentDeltas.push(delta);
              accumulatedText = text;
            }
          }
        } else if (evt.type === "patch") {
          const operations = evt.operations || [];
          for (const op of operations) {
            if (op.op === "delta" && op.path === "/sections/0/view_model/primitive/text" && typeof op.value === "string") {
              contentDeltas.push(op.value);
              accumulatedText += op.value;
            }
          }
        }
      }
    };

    ws.onerror = () => fail("Meta AI WebSocket connection error");
    ws.onclose = () => {
      if (settled) return;
      finish({ content: accumulatedText, deltas: contentDeltas });
    };
  });
}
