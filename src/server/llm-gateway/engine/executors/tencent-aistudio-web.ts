import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import type { Credentials, Logger } from "../services/types";

const TENCENT_AISTUDIO_API = PROVIDERS["tencent-aistudio-web"].baseUrl as string;
const TENCENT_AISTUDIO_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

export class TencentAistudioWebExecutor extends BaseExecutor {
  constructor() {
    super("tencent-aistudio-web", PROVIDERS["tencent-aistudio-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: TENCENT_AISTUDIO_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const headers: Record<string, string> = {
      "Accept": "text/event-stream, */*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      "Origin": "https://aistudio.tencent.com",
      "Pragma": "no-cache",
      "Referer": "https://aistudio.tencent.com/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": TENCENT_AISTUDIO_USER_AGENT,
    };

    if (credentials.apiKey) {
      headers["Cookie"] = credentials.apiKey;
    }

    const payload: Record<string, unknown> = {
      ...body,
      model: model || "tencent-aistudio-default",
      stream: stream !== false,
    };

    log?.info?.("TENCENT-AISTUDIO-WEB", `Query to ${model}, stream=${stream}`);

    let response: Response;
    try {
      response = await fetch(TENCENT_AISTUDIO_API, {
        method: "POST", headers, body: JSON.stringify(payload), signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("TENCENT-AISTUDIO-WEB", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Tencent AI Studio connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: TENCENT_AISTUDIO_API, headers, transformedBody: payload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Tencent AI Studio returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Tencent AI Studio auth failed — session cookie may be expired. Re-paste your cookie from aistudio.tencent.ai.";
      else if (status === 429) errMsg = "Tencent AI Studio rate limited. Wait a moment and retry.";
      log?.warn?.("TENCENT-AISTUDIO-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: TENCENT_AISTUDIO_API, headers, transformedBody: payload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Tencent AI Studio returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: TENCENT_AISTUDIO_API, headers, transformedBody: payload };
    }

    // Tencent AI Studio returns OpenAI-compatible SSE — pass through directly
    if (stream !== false) {
      const finalResponse = new Response(response.body, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      });
      return { response: finalResponse, url: TENCENT_AISTUDIO_API, headers, transformedBody: payload };
    }

    return { response, url: TENCENT_AISTUDIO_API, headers, transformedBody: payload };
  }
}

export default TencentAistudioWebExecutor;
