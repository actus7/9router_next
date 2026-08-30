import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { proxyAwareFetch } from "../utils/proxyFetch";
import type { Logger } from "../services/types";
import type { ExecuteArgs } from "./base";

// Ported from the upstream reference implementation (diegosouzapw/OmniRoute,
// open-sse/executors/theoldllm.ts) — the correct upstream is theoldllm.vercel.app
// (theoldllm.com is an unrelated paid $7/mo service; see docs at
// https://theoldllm.com/docs, which explicitly states no free/demo tokens exist).
// The site's SPA generates X-Request-Token client-side via a deterministic djb2-style
// hash — no headless browser is needed to reproduce it server-side.
const THEOLDLLM_API = PROVIDERS["theoldllm"].baseUrl as string;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const CLIENT_VERSION = "3.8.4";
const TOKEN_SEED = "oldllm-client-2026";
const UA_PREFIX = USER_AGENT.slice(0, 20); // "Mozilla/5.0 (Windows"

// ── Model name mapping ────────────────────────────────────────────────────

const GPT_MODELS: Record<string, string> = {
  "gpt-5.4": "GPT_5_4",
  "gpt-5.3": "GPT_5_3",
  "gpt-5.2": "GPT_5_2",
  "gpt-5.1": "GPT_5_1",
  "gpt-5": "GPT_5",
  gpt5_4: "GPT_5_4",
  gpt5_3: "GPT_5_3",
  gpt5_2: "GPT_5_2",
  gpt5_1: "GPT_5_1",
  gpt_4o: "GPT_4O",
  "gpt-4o": "GPT_4O",
  gpt_5_3: "GPT_5_3",
  gpt_5_2: "GPT_5_2",
  gpt_5_1: "GPT_5_1",
  gpt_5: "GPT_5",
};

const CLAUDE_NAMES: Record<string, string> = {
  "claude-4.6-opus": "CLAUDE_4_6_OPUS",
  "claude-4.6-sonnet": "CLAUDE_4_6_SONNET",
  "claude-4.5-haiku": "CLAUDE_4_5_HAIKU",
  claude_opus_4: "CLAUDE_4_6_OPUS",
  claude_sonnet_4: "CLAUDE_4_6_SONNET",
  claude_haiku_3_5: "CLAUDE_4_5_HAIKU",
  "claude opus 4": "CLAUDE_4_6_OPUS",
  "claude sonnet 4": "CLAUDE_4_6_SONNET",
  "claude haiku 3.5": "CLAUDE_4_5_HAIKU",
};

// Canonical upstream model IDs served by theoldllm's /api/chatgpt proxy.
// These pass through mapModel() UNCHANGED — critical for non-GPT/Claude models
// (Gemini, o-series, Grok, DeepSeek, Sonar) which would otherwise fall through
// to the GPT_5_4 default and silently misroute.
export const CHATGPT_UPSTREAM_MODELS: ReadonlySet<string> = new Set<string>([
  "GPT_5_4",
  "GPT_5_3",
  "GPT_5_2",
  "GPT_5_1",
  "GPT_5",
  "GPT_o4_mini",
  "GPT_o3_mini",
  "gemini_3_pro",
  "gemini_2_5_pro",
  "gemini_2_0_flash",
  "gemini_1_5_flash",
  "CLAUDE_4_6_OPUS",
  "CLAUDE_4_6_SONNET",
  "CLAUDE_4_5_HAIKU",
  "openrouter_gpt_4_o",
  "openrouter_gpt_4_o_mini",
  "openrouter_gpt_4",
  "openrouter_grok_4",
  "together_deepseek_r1",
  "openrouter_deepseek_r1",
  "together_deepseek_v3",
  "openrouter_deepseek_v3",
  "sonar-deep-research",
  "sonar-pro",
  "openrouter_web_search",
]);

export function mapModel(model: string): string {
  const trimmed = model.trim();
  if (CHATGPT_UPSTREAM_MODELS.has(trimmed)) return trimmed;
  const n = model.toLowerCase().trim();
  const gptKey = n.replace(/[_\s]+/g, "-");
  if (GPT_MODELS[gptKey]) return GPT_MODELS[gptKey];
  const gptKey2 = n.replace(/[-\s]+/g, "_");
  if (GPT_MODELS[gptKey2]) return GPT_MODELS[gptKey2];
  if (CLAUDE_NAMES[n]) return CLAUDE_NAMES[n];
  if (n.includes("claude")) {
    if (n.includes("opus")) return "CLAUDE_4_6_OPUS";
    if (n.includes("sonnet")) return "CLAUDE_4_6_SONNET";
    if (n.includes("haiku")) return "CLAUDE_4_5_HAIKU";
  }
  if (n.includes("gpt") && n.includes("5")) return "GPT_5_4";
  return "GPT_5_4";
}

// ── Token generation (mirrors client-side rie() from theoldllm.vercel.app) ──
export function generateRequestToken(): string {
  const n = Date.now();
  const e = `${n}-${TOKEN_SEED}-${UA_PREFIX}`;
  let t = 0;
  for (let i = 0; i < e.length; i++) {
    const s = e.charCodeAt(i);
    t = (t << 5) - t + s;
    t = t & t;
  }
  const r = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${n.toString(36)}-${Math.abs(t).toString(36)}-${r}`;
}

function isVercelMitigationResponse(status: number, mitigationHeader: string | null, body: string): boolean {
  const mitigation = mitigationHeader?.toLowerCase();
  if (mitigation === "deny" || mitigation === "challenge") return true;
  return (status === 403 || status === 429) && /vercel security checkpoint|"message"\s*:\s*"forbidden"/i.test(body);
}

function isTokenRejected(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  try {
    const p = JSON.parse(body) as { error?: { type?: string } | string };
    return (
      (typeof p?.error === "object" && p.error?.type === "access_denied") ||
      (typeof p?.error === "string" && /blocked|denied|invalid/i.test(p.error))
    );
  } catch {
    return false;
  }
}

function parseSseContent(sseText: string): string {
  let content = "";
  for (const line of sseText.split("\n")) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const d = JSON.parse(line.slice(6)) as { choices?: { delta?: { content?: string; text?: string } }[] };
        content += d.choices?.[0]?.delta?.content || d.choices?.[0]?.delta?.text || "";
      } catch { /* skip malformed SSE line */ }
    }
  }
  return content;
}

function buildChatCompletion(content: string, model: string): string {
  return JSON.stringify({
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: mapModel(model),
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

function buildErrorResponse(status: number, body: string): string {
  let detail = body;
  for (const line of body.split("\n")) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const p = JSON.parse(line.slice(6)) as { error?: unknown };
        if (p.error) {
          detail = JSON.stringify(p.error);
          break;
        }
      } catch { /* skip malformed SSE line */ }
    }
  }
  return JSON.stringify({ error: { message: detail, type: "upstream_error", code: `HTTP_${status}` } });
}

export class TheOldLLMExecutor extends BaseExecutor {
  constructor() {
    super("theoldllm", PROVIDERS["theoldllm"]);
  }

  buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-Client-Version": CLIENT_VERSION,
      "User-Agent": USER_AGENT,
    };
  }

  private async fetchUpstream(reqBody: Record<string, unknown>, signal: AbortSignal | undefined, proxyOptions: unknown) {
    const doFetch = () => proxyAwareFetch(THEOLDLLM_API, {
      method: "POST",
      headers: { ...this.buildHeaders(), "X-Request-Token": generateRequestToken() },
      body: JSON.stringify(reqBody),
      signal,
    }, proxyOptions as null);

    let response = await doFetch();
    let body = await response.text();
    let vercelMitigated = isVercelMitigationResponse(response.status, response.headers.get("x-vercel-mitigated"), body);
    if (!vercelMitigated && isTokenRejected(response.status, body)) {
      response = await doFetch();
      body = await response.text();
      vercelMitigated = isVercelMitigationResponse(response.status, response.headers.get("x-vercel-mitigated"), body);
    }
    return { response, body, vercelMitigated };
  }

  async execute({ model, body, stream, signal, log, proxyOptions }: ExecuteArgs) {
    const headers = this.buildHeaders();
    const reqBody = { ...body, model: mapModel(model), stream: true };

    try {
      const { response, body: finalBody, vercelMitigated } = await this.fetchUpstream(reqBody, signal, proxyOptions);

      if (response.status === 200 && finalBody) {
        const payload = stream ? finalBody : buildChatCompletion(parseSseContent(finalBody), model);
        return {
          response: new Response(payload, {
            status: 200,
            headers: { "Content-Type": stream ? "text/event-stream" : "application/json", "Cache-Control": "no-cache" },
          }),
          url: THEOLDLLM_API,
          headers,
          transformedBody: reqBody,
        };
      }

      const errorPayload = vercelMitigated
        ? JSON.stringify({
            error: {
              message: "The Old LLM is blocked by Vercel for this server egress IP. Configure a residential provider or global proxy for 'theoldllm' and retry.",
              type: "upstream_access_denied",
              code: "THEOLDLLM_VERCEL_MITIGATED",
            },
          })
        : buildErrorResponse(response.status, finalBody);
      return {
        response: new Response(errorPayload, { status: response.status, headers: { "Content-Type": "application/json" } }),
        url: THEOLDLLM_API,
        headers,
        transformedBody: reqBody,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      (log as Logger | undefined)?.error?.("THEOLDLLM", `Executor error: ${msg}`);
      return {
        response: new Response(JSON.stringify({ error: { message: msg, type: "upstream_error", code: "EXECUTOR_ERROR" } }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
        url: THEOLDLLM_API,
        headers,
        transformedBody: reqBody,
      };
    }
  }
}

export default TheOldLLMExecutor;
