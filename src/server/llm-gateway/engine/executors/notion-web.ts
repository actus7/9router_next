import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import type { Credentials, Logger } from "../services/types";

const NOTION_API = PROVIDERS["notion-web"].baseUrl as string;
const NOTION_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

export class NotionWebExecutor extends BaseExecutor {
  constructor() {
    super("notion-web", PROVIDERS["notion-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: NOTION_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const headers: Record<string, string> = {
      "Accept": "text/event-stream, */*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      "Origin": "https://www.notion.so",
      "Pragma": "no-cache",
      "Referer": "https://www.notion.so/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": NOTION_USER_AGENT,
    };

    if (credentials.apiKey) {
      headers["Cookie"] = `token_v2=${credentials.apiKey}`;
    }

    const payload: Record<string, unknown> = {
      ...body,
      model: model || "notion-default",
      stream: stream !== false,
    };

    log?.info?.("NOTION-WEB", `Query to ${model}, stream=${stream}`);

    let response: Response;
    try {
      response = await fetch(NOTION_API, {
        method: "POST", headers, body: JSON.stringify(payload), signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("NOTION-WEB", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Notion connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: NOTION_API, headers, transformedBody: payload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Notion returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Notion auth failed — token_v2 may be expired. Re-paste your token from app.notion.com.";
      else if (status === 429) errMsg = "Notion rate limited. Wait a moment and retry.";
      log?.warn?.("NOTION-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: NOTION_API, headers, transformedBody: payload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Notion returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: NOTION_API, headers, transformedBody: payload };
    }

    // Notion returns OpenAI-compatible SSE — pass through directly
    if (stream !== false) {
      const finalResponse = new Response(response.body, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      });
      return { response: finalResponse, url: NOTION_API, headers, transformedBody: payload };
    }

    return { response, url: NOTION_API, headers, transformedBody: payload };
  }
}

export default NotionWebExecutor;
