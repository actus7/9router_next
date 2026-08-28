// Codex (ChatGPT Plus/Pro) image generation via Responses API + SSE
import { randomUUID } from "node:crypto";
import { nowSec } from "./_base";
import { PROVIDERS } from "../../config/providers";

const CODEX_RESPONSES_URL = PROVIDERS["codex"].baseUrl as string;
const CODEX_USER_AGENT = "codex_cli_rs/0.136.0";
const CODEX_VERSION = "0.136.0";
const CODEX_ORIGINATOR = "codex_cli_rs";
const CODEX_MODEL_SUFFIX = "-image";
const CODEX_REF_DETAIL = "high";

function decodeAccountId(idToken: string): string | null {
  try {
    const parts = String(idToken || "").split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (b64.length % 4)) % 4;
    const payload = JSON.parse(Buffer.from(b64 + "=".repeat(pad), "base64").toString("utf8"));
    return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id || null;
  } catch {
    return null;
  }
}

function stripImageSuffix(model: string): string {
  return model.endsWith(CODEX_MODEL_SUFFIX) ? model.slice(0, -CODEX_MODEL_SUFFIX.length) : model;
}

function toDataUrl(input: unknown): string | null {
  if (!input || typeof input !== "string") return null;
  if (/^data:image\//i.test(input) || /^https?:\/\//i.test(input)) return input;
  return `data:image/png;base64,${input}`;
}

function buildContent(prompt: string, refs: string[], detail: string = CODEX_REF_DETAIL): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  refs.forEach((url: string, index: number) => {
    content.push({ type: "input_text", text: `<image name=image${index + 1}>` });
    content.push({ type: "input_image", image_url: url, detail });
    content.push({ type: "input_text", text: "</image>" });
  });
  content.push({ type: "input_text", text: prompt });
  return content;
}

interface CodexCallbacks {
  onProgress?: (info: Record<string, unknown>) => void;
  onPartialImage?: (info: Record<string, unknown>) => void;
}

// Parse Codex SSE stream → final base64 image. Optional callbacks for client streaming.
async function parseStream(response: Response, log?: Record<string, unknown>, callbacks: CodexCallbacks = {}): Promise<string | null> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let imageB64: string | null = null;
  let lastEvent: string | null = null;
  let bytesReceived = 0;
  let lastProgressLogMs = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesReceived += value?.byteLength || 0;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx;
    while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);

      const lines = block.split("\n");
      let eventName: string | null = null;
      let dataStr = "";
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
      }
      if (!eventName) continue;
      if (eventName !== lastEvent) {
        (log as { info?: (...a: unknown[]) => void })?.info?.("IMAGE", `codex progress: ${eventName}`);
        lastEvent = eventName;
      }

      const now = Date.now();
      if (callbacks.onProgress && now - lastProgressLogMs > 200) {
        lastProgressLogMs = now;
        callbacks.onProgress({ stage: eventName, bytesReceived });
      }

      if (eventName === "response.image_generation_call.partial_image" && dataStr) {
        try {
          const data = JSON.parse(dataStr);
          if (callbacks.onPartialImage && data?.partial_image_b64) {
            callbacks.onPartialImage({ b64_json: data.partial_image_b64, index: data.partial_image_index });
          }
        } catch {}
      }

      if (eventName === "response.output_item.done" && dataStr) {
        try {
          const data = JSON.parse(dataStr);
          const item = data?.item;
          if (item?.type === "image_generation_call" && item.result) {
            imageB64 = item.result;
          }
        } catch {}
      }
    }
  }
  return imageB64;
}

// SSE Response that pipes codex progress + partial + done events to client
function buildSseResponse(providerResponse: Response, log?: Record<string, unknown>, onSuccess?: () => void | Promise<void>): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const b64 = await parseStream(providerResponse, log, {
          onProgress: (info: Record<string, unknown>) => send("progress", info),
          onPartialImage: (info: Record<string, unknown>) => send("partial_image", info),
        });
        if (!b64) {
          send("error", { message: "Codex did not return an image. Account may not be entitled (Plus/Pro required)." });
        } else {
          if (onSuccess) await onSuccess();
          send("done", { created: nowSec(), data: [{ b64_json: b64 }] });
        }
      } catch (err: unknown) {
        send("error", { message: (err as Error)?.message || "Stream failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default {
  stream: true,
  buildUrl: (): string => CODEX_RESPONSES_URL,
  buildHeaders: (creds: Record<string, unknown>): Record<string, string> => {
    const accountId = (creds?.providerSpecificData as Record<string, unknown>)?.chatgptAccountId as string || decodeAccountId(creds?.idToken as string);
    return {
      "accept": "text/event-stream, application/json",
      "authorization": `Bearer ${creds?.accessToken || ""}`,
      "chatgpt-account-id": accountId || "",
      "content-type": "application/json",
      "originator": CODEX_ORIGINATOR,
      "session_id": randomUUID(),
      "user-agent": CODEX_USER_AGENT,
      "version": CODEX_VERSION,
      "x-client-request-id": randomUUID(),
    };
  },
  buildBody: (model: string, body: Record<string, unknown>): Record<string, unknown> => {
    const refs: string[] = [];
    if (Array.isArray(body.images)) body.images.forEach((i: unknown) => { const u = toDataUrl(i); if (u) refs.push(u); });
    const single = toDataUrl(body.image);
    if (single) refs.push(single);
    const detail = (body.image_detail as string) || CODEX_REF_DETAIL;
    const imgTool: Record<string, unknown> = { type: "image_generation", output_format: ((body.output_format as string) || "png").toLowerCase() };
    if (body.size && body.size !== "") imgTool.size = body.size;
    if (body.quality && body.quality !== "") imgTool.quality = body.quality;
    if (body.background && body.background !== "") imgTool.background = body.background;
    return {
      model: stripImageSuffix(model),
      instructions: "",
      input: [{ type: "message", role: "user", content: buildContent(body.prompt as string, refs, detail) }],
      tools: [imgTool],
      tool_choice: "auto",
      parallel_tool_calls: false,
      prompt_cache_key: randomUUID(),
      stream: true,
      store: false,
      reasoning: null,
    };
  },
  // Custom: codex parses SSE → either pipe to client or collect b64
  async parseResponse(response: Response, { log, streamToClient, onRequestSuccess }: Record<string, unknown>) {
    if (streamToClient) {
      return { sseResponse: buildSseResponse(response, log as Record<string, unknown>, onRequestSuccess as () => void | Promise<void>) };
    }
    const b64 = await parseStream(response, log as Record<string, unknown>);
    if (!b64) {
      throw new Error("Codex did not return an image. Account may not be entitled (Plus/Pro required).");
    }
    return { created: nowSec(), data: [{ b64_json: b64 }] };
  },
  normalize: (responseBody: Record<string, unknown>): Record<string, unknown> => responseBody,
};
