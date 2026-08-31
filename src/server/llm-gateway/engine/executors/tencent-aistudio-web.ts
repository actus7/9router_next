import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import type { Credentials, Logger } from "../services/types";

// Real endpoint is per-model, not a single static URL: aistudio.tencent.ai
// (.ai TLD, not .com) exposes one path per Hunyuan model variant.
const AISTUDIO_BASE = "https://aistudio.tencent.ai";
const MODEL_MAP: Record<string, string> = {
  "hy3-g": "HunyuanDefault",
  "hunyuan-default": "HunyuanDefault",
  "hunyuan-3d": "Hunyuan3D",
};
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export class TencentAistudioWebExecutor extends BaseExecutor {
  constructor() {
    super("tencent-aistudio-web", PROVIDERS["tencent-aistudio-web"]);
  }

  async execute({ model, body, credentials, signal, log }: { model: string; body: Record<string, unknown>; stream: boolean; credentials: Credentials; signal?: AbortSignal; log?: Logger }) {
    const targetModelId = model || "hy3-g";
    const targetModel = MODEL_MAP[targetModelId] || "HunyuanDefault";
    const chatUrl = `${AISTUDIO_BASE}/api/chat/${targetModel}`;

    const cookie = credentials.apiKey || "";
    if (!cookie) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Tencent AI Studio cookie is required. Log in to aistudio.tencent.ai and paste your Cookie header.", type: "invalid_request", code: "missing_cookie" },
      }), { status: 401, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: chatUrl, headers: {} as Record<string, string>, transformedBody: body };
    }

    const messages = (body.messages as Array<{ role: string; content: string }>) || [];
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: AISTUDIO_BASE,
      Referer: `${AISTUDIO_BASE}/`,
      "User-Agent": USER_AGENT,
    };

    const upstreamBody = { model: targetModel, messages };
    log?.info?.("TENCENT-AISTUDIO-WEB", `Query to ${targetModel}`);

    let upstream: Response;
    try {
      upstream = await fetch(chatUrl, { method: "POST", headers, body: JSON.stringify(upstreamBody), signal });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error?.("TENCENT-AISTUDIO-WEB", `Fetch failed: ${errMsg}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Tencent AI Studio connection failed: ${errMsg}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: chatUrl, headers, transformedBody: upstreamBody };
    }

    // Omni's real client proxies the upstream response verbatim (status,
    // headers, body) — the Hunyuan endpoint already returns OpenAI-shaped output.
    return {
      response: new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers }),
      url: chatUrl, headers, transformedBody: upstreamBody,
    };
  }
}

export default TencentAistudioWebExecutor;
