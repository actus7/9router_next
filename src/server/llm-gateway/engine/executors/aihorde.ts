import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { proxyAwareFetch } from "../utils/proxyFetch";
import { dbg } from "../utils/debugLog";
import type { Credentials } from "../services/types";
import { isEmptyChatCompletion } from "../handlers/chatCore/emptyCompletion";

/**
 * AIHordeExecutor — queue-based executor for AI Horde's OpenAI-compatible proxy.
 *
 * AI Horde is community-powered (volunteer workers) and diverges from the
 * OpenAI contract in ways that would 422 or corrupt analytics:
 *
 *  - QUEUED execution: a request waits for volunteer workers, so a single call
 *    can take tens of seconds to minutes (120s timeout).
 *  - Upstream is called non-streaming and the answer re-emitted as SSE, so a
 *    broken worker's empty 200 can still be turned into a failure.
 *  - `max_tokens` must be >= 16, and at most what the model's workers declare
 *    (1024–2560, live 2026-10-31) and what fits the context after the prompt;
 *    the proxy 400s naming the limit, and we retry at it (`fittingMaxTokens`).
 *  - Tool calling works since 2026-10 (live-probed); `tool_choice` without
 *    `tools` 400s, so it only rides along with tools.
 *  - Older proxy builds answered `usage: {"kudos": N}`; only then we estimate.
 *  - Auth: anonymous with sentinel key `0000000000` (lowest priority);
 *    a real aihorde.net key gets higher queue priority.
 */

const ANON_KEY = "0000000000";
const MIN_MAX_TOKENS = 16;
const MAX_MAX_TOKENS = 16384; // API-wide ceiling: "The token limit must be between 16 and 16384" (live 2026-10-31)
const DEFAULT_MAX_TOKENS = 512;
// Anonymous ceiling: with the sentinel key anything above 512 answers
// `503 no_eligible_worker` even when the worker declares 2048 (live 2026-10-31).
const ANON_MAX_TOKENS = 512;
const HORDE_TIMEOUT_MS = 120_000;
const PASSTHROUGH_PARAMS = ["temperature", "top_p", "seed", "presence_penalty", "response_format", "reasoning_effort"];
const WORKER_LIMIT_RE = /declares now is (\d+) tokens/;
const CONTEXT_LIMIT_RE = /estimated at (\d+) tokens.*max_context_length of (\d+)/;
const MAX_LIMIT_RETRIES = 2;

/** The max_tokens a `400` says would have fitted, or null when it is another error.
 *  Both shapes live-captured 2026-10-31; a request can hit one, then the other. */
function fittingMaxTokens(errText: string): number | null {
  const worker = WORKER_LIMIT_RE.exec(errText);
  if (worker) return Number(worker[1]);
  const context = CONTEXT_LIMIT_RE.exec(errText);
  if (context) return Number(context[2]) - Number(context[1]);
  return null;
}

/** Rough token estimate (~4 chars/token) for synthesized usage. */
function estimateTokens(content: unknown): number {
  if (content == null) return 0;
  let text: string;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((block: unknown) => (typeof block === "string" ? block : ((block as Record<string, unknown>)?.text as string ?? "")))
      .join(" ");
  } else {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

/** Resolve the bearer token: anonymous sentinel or a real key.
 *  Maps the synthetic noAuth credential ("public") to the anonymous sentinel. */
function resolveBearer(credentials: Credentials): string {
  const k = (credentials.apiKey || credentials.accessToken || "").trim();
  if (!k || k === "no-key" || k === ANON_KEY || k === "public") return ANON_KEY;
  return k;
}

export class AIHordeExecutor extends BaseExecutor {
  constructor() {
    super("aihorde", {
      ...(PROVIDERS.aihorde || {}),
      timeoutMs: HORDE_TIMEOUT_MS,
    });
  }

  buildHeaders(credentials: Credentials) {
    // Upstream is always ONE non-streaming JSON call (queue-based generation).
    // Never send `Accept: text/event-stream` — the proxy 406s an SSE Accept on
    // a JSON POST (live-probed). JSON Accept matches the actual request body.
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${resolveBearer(credentials)}`,
    };
  }

  /** Transform the request body to what AI Horde's OpenAI proxy accepts. */
  transformRequest(model: string, body: Record<string, unknown>, _stream?: boolean, credentials?: Credentials) {
    const transformed: Record<string, unknown> = {
      model: typeof body.model === "string" ? body.model : model,
      messages: body.messages,
    };

    const mt = (body.max_tokens ?? body.max_completion_tokens) as number | undefined;
    const ceiling = credentials && resolveBearer(credentials) === ANON_KEY ? ANON_MAX_TOKENS : MAX_MAX_TOKENS;
    transformed.max_tokens = Math.min(ceiling, Math.max(MIN_MAX_TOKENS, mt ?? DEFAULT_MAX_TOKENS));

    for (const key of PASSTHROUGH_PARAMS) {
      if (body[key] != null) transformed[key] = body[key];
    }
    if (body.stop != null) {
      transformed.stop = Array.isArray(body.stop) ? body.stop : [body.stop];
    }
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      transformed.tools = body.tools;
      if (body.tool_choice != null) transformed.tool_choice = body.tool_choice;
      if (body.parallel_tool_calls != null) transformed.parallel_tool_calls = body.parallel_tool_calls;
    }

    return transformed;
  }

  /**
   * Synthesize token usage from the response. AI Horde returns `{"kudos": N}`
   * instead of token counts — we estimate from message content lengths.
   */
  private synthesizeUsage(body: Record<string, unknown>, data: Record<string, unknown>): void {
    if (typeof (data.usage as Record<string, unknown> | undefined)?.prompt_tokens === "number") return;
    const messages = (body.messages as Array<Record<string, unknown>>) || [];
    const prompt = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const choices = (data.choices as Array<Record<string, unknown>>) || [];
    const completion = choices.reduce(
      (sum, c) => sum + estimateTokens((c.message as Record<string, unknown>)?.content),
      0,
    );
    data.usage = {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
    };
  }

  /**
   * Parse AI Horde error responses. They use `{"detail": "..."}` shape.
   */
  override parseError(response: Response, bodyText: string) {
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(bodyText); } catch { /* ignore */ }
    const detail = parsed?.detail;
    if (typeof detail === "string" && detail.length > 0) {
      return { status: response.status, message: detail };
    }
    const msg = (parsed?.error as Record<string, unknown>)?.message;
    if (typeof msg === "string" && msg.length > 0) {
      return { status: response.status, message: msg };
    }
    return { status: response.status, message: bodyText || `HTTP ${response.status}` };
  }

  /**
   * Override execute to handle AI Horde's queue-based, non-streaming nature.
   *
   * For streaming requests: make a non-streaming call upstream, then emit the
   * result as a single SSE chunk sequence (role → content → finish).
   * For non-streaming: standard call with usage synthesis.
   */
  async execute(opts: import("./base").ExecuteArgs) {
    const { model, body, stream, credentials, signal, proxyOptions } = opts;

    const url = this.buildUrl(model, false, 0, credentials); // always non-streaming upstream
    const transformedBody = this.transformRequest(model, body, stream, credentials);
    const headers = this.buildHeaders(credentials);

    const timeoutMs = (this.config?.timeoutMs as number) || HORDE_TIMEOUT_MS;
    const connectCtrl = new AbortController();
    const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
    const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

    dbg("AIHORDE", `→ ${url} | body=${JSON.stringify(transformedBody).length}B | timeout=${timeoutMs}ms`);

    try {
      let response = await this.post(url, headers, transformedBody, mergedSignal, proxyOptions);
      for (let retry = 0; retry < MAX_LIMIT_RETRIES && response.status === 400; retry++) {
        const errText = await response.text().catch(() => "");
        const limit = fittingMaxTokens(errText);
        if (limit == null || limit < MIN_MAX_TOKENS || limit >= (transformedBody.max_tokens as number)) {
          response = new Response(errText, { status: 400 });
          break;
        }
        transformedBody.max_tokens = limit;
        response = await this.post(url, headers, transformedBody, mergedSignal, proxyOptions);
      }

      clearTimeout(connectTimer);

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        const { message } = this.parseError(response, errText);
        throw new Error(`AI Horde API error ${response.status}: ${message}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      this.synthesizeUsage(body, data);

      // The queued proxy reports HTTP 200 even when the volunteer worker
      // serving this model is broken and produced nothing — live-observed on
      // koboldcpp/Gemma-4-E4B-it-Ultra-Uncensored-Heretic, reproduced 3/3
      // times. Throwing here routes through the normal executor error path
      // (chatCore's catch → account/provider fallback) instead of forwarding
      // a silent empty message.
      if (isEmptyChatCompletion(data)) {
        throw new Error(
          `AI Horde returned an empty completion for "${model}" — the volunteer worker serving this model is likely misconfigured. Try again or pick a different model.`,
        );
      }

      dbg("AIHORDE", `← ${response.status} | model=${model} | usage=${JSON.stringify(data.usage)}`);

      // For streaming: wrap the complete response as a single SSE chunk sequence
      if (stream) {
        return this.wrapAsStream(data, model);
      }

      // Non-streaming: return the response directly
      return { response: this.makeJsonResponse(data), url, headers, transformedBody };
    } catch (e) {
      clearTimeout(connectTimer);
      throw e;
    }
  }

  private post(url: string, headers: Record<string, string>, body: Record<string, unknown>, signal: AbortSignal, proxyOptions: unknown) {
    return proxyAwareFetch(url, { method: "POST", headers, body: JSON.stringify(body), signal }, proxyOptions as null);
  }

  /**
   * Wrap a complete AI Horde response as a streaming SSE response.
   * Emits: role delta → content delta → finish delta (OpenAI chunk format).
   */
  private wrapAsStream(data: Record<string, unknown>, model: string) {
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    const content = typeof (choice?.message as Record<string, unknown>)?.content === "string"
      ? ((choice?.message as Record<string, unknown>).content as string)
      : "";
    const toolCalls = ((choice?.message as Record<string, unknown>)?.tool_calls as Array<Record<string, unknown>> | undefined)
      ?.map((tc, index) => ({ index, ...tc }));
    const finishReason = (choice?.finish_reason as string) || (toolCalls?.length ? "tool_calls" : "stop");
    const id = (data.id as string) || `chatcmpl-${Date.now()}`;
    const created = (data.created as number) || Math.floor(Date.now() / 1000);

    const chunks = [
      // Role delta
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
      // Content delta
      ...(content ? [`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`] : []),
      ...(toolCalls?.length ? [`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }] })}

`] : []),
      // Finish delta
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`,
      // Usage chunk (if available)
      ...(data.usage ? [`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage: data.usage })}\n\n`] : []),
      "data: [DONE]\n\n",
    ];

    const sseBody = chunks.join("");
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody));
        controller.close();
      },
    });

    return {
      response: new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }),
      url: this.config.baseUrl as string,
      headers: {},
      transformedBody: {},
    };
  }

  /**
   * Create a synthetic Response object with JSON body.
   */
  private makeJsonResponse(data: Record<string, unknown>) {
    const body = JSON.stringify(data);
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
