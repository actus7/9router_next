import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import type { Credentials, Logger } from "../services/types";

const YUANBAO_API = PROVIDERS["yuanbao-web"].baseUrl as string;
const YUANBAO_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

export class YuanbaoWebExecutor extends BaseExecutor {
  constructor() {
    super("yuanbao-web", PROVIDERS["yuanbao-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: YUANBAO_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const headers: Record<string, string> = {
      "Accept": "text/event-stream, */*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      "Origin": "https://yuanbao.tencent.com",
      "Pragma": "no-cache",
      "Referer": "https://yuanbao.tencent.com/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": YUANBAO_USER_AGENT,
    };

    if (credentials.apiKey) {
      headers["Cookie"] = credentials.apiKey;
    }

    const payload: Record<string, unknown> = {
      ...body,
      model: model || "yuanbao-default",
      stream: stream !== false,
    };

    log?.info?.("YUANBAO-WEB", `Query to ${model}, stream=${stream}`);

    let response: Response;
    try {
      response = await fetch(YUANBAO_API, {
        method: "POST", headers, body: JSON.stringify(payload), signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("YUANBAO-WEB", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Yuanbao connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: YUANBAO_API, headers, transformedBody: payload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Yuanbao returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Yuanbao auth failed — cookies may be expired. Re-paste your hy_user and hy_token cookies from yuanbao.tencent.com.";
      else if (status === 429) errMsg = "Yuanbao rate limited. Wait a moment and retry.";
      log?.warn?.("YUANBAO-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: YUANBAO_API, headers, transformedBody: payload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Yuanbao returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: YUANBAO_API, headers, transformedBody: payload };
    }

    // Yuanbao returns OpenAI-compatible SSE — pass through directly
    if (stream !== false) {
      const finalResponse = new Response(response.body, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      });
      return { response: finalResponse, url: YUANBAO_API, headers, transformedBody: payload };
    }

    return { response, url: YUANBAO_API, headers, transformedBody: payload };
  }
}

export default YuanbaoWebExecutor;
