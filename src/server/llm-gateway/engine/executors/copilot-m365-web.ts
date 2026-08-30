import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants";
import type { Credentials, Logger } from "../services/types";

const M365_API = PROVIDERS["copilot-m365-web"].baseUrl as string;
const M365_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

export class CopilotM365WebExecutor extends BaseExecutor {
  constructor() {
    super("copilot-m365-web", PROVIDERS["copilot-m365-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const messages = body?.messages as Record<string, unknown>[] | undefined;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: M365_API, headers: {} as Record<string, string>, transformedBody: body };
    }

    const headers: Record<string, string> = {
      "Accept": "text/event-stream, */*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      "Origin": "https://copilot.microsoft.com",
      "Pragma": "no-cache",
      "Referer": "https://copilot.microsoft.com/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": M365_USER_AGENT,
    };

    // M365 Copilot uses Bearer token (access_token), not cookie
    if (credentials.apiKey) {
      headers["Authorization"] = `Bearer ${credentials.apiKey}`;
    }

    const payload: Record<string, unknown> = {
      ...body,
      model: model || "m365-copilot-default",
      stream: stream !== false,
    };

    log?.info?.("COPILOT-M365-WEB", `Query to ${model}, stream=${stream}`);

    let response: Response;
    try {
      response = await fetch(M365_API, {
        method: "POST", headers, body: JSON.stringify(payload), signal,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("COPILOT-M365-WEB", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `M365 Copilot connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: M365_API, headers, transformedBody: payload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `M365 Copilot returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "M365 Copilot auth failed — access_token may be expired (~75min lifetime). Re-paste your token from copilot.microsoft.com.";
      else if (status === 429) errMsg = "M365 Copilot rate limited. Wait a moment and retry.";
      log?.warn?.("COPILOT-M365-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: M365_API, headers, transformedBody: payload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "M365 Copilot returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: M365_API, headers, transformedBody: payload };
    }

    // M365 Copilot returns OpenAI-compatible SSE — pass through directly
    if (stream !== false) {
      const finalResponse = new Response(response.body, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      });
      return { response: finalResponse, url: M365_API, headers, transformedBody: payload };
    }

    return { response, url: M365_API, headers, transformedBody: payload };
  }
}

export default CopilotM365WebExecutor;
