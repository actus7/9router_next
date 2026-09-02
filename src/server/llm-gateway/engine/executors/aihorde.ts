import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { proxyAwareFetch } from "../utils/proxyFetch";
import { dbg } from "../utils/debugLog";
import type { Credentials } from "../services/types";

/**
 * AIHordeExecutor — queue-based executor for AI Horde's OpenAI-compatible proxy.
 *
 * AI Horde is community-powered (volunteer workers) and diverges from the
 * OpenAI contract in ways that would 422 or corrupt analytics:
 *
 *  - QUEUED execution: a request waits for volunteer workers, so a single call
 *    can take tens of seconds to minutes (120s timeout).
 *  - No real streaming: the proxy returns one queued generation as a single
 *    response. We emit it as a single SSE chunk for streaming clients.
 *  - `max_tokens` must be >= 16 or the proxy 422s.
 *  - `stop` must be an array; a bare string 422s.
 *  - No tool calling: tools/tool_choice/parallel_tool_calls are dropped.
 *  - `usage` comes back as `{"kudos": N}` — we synthesize token estimates.
 *  - Auth: anonymous with sentinel key `0000000000` (lowest priority);
 *    a real aihorde.net key gets higher queue priority.
 */

const ANON_KEY = "0000000000";
const MIN_MAX_TOKENS = 16;
const DEFAULT_MAX_TOKENS = 512;
const HORDE_TIMEOUT_MS = 120_000;

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

  /**
   * Transform the request body for AI Horde compatibility:
   * - Forward only the parameters supported by its queued OpenAI proxy
   * - Floor max_tokens to >= 16, default to 512 if omitted
   * - Wrap string stop in an array
   */
  transformRequest(model: string, body: Record<string, unknown>, _stream?: boolean, _credentials?: Credentials) {
    const transformed: Record<string, unknown> = {
      model: typeof body.model === "string" ? body.model : model,
      messages: body.messages,
    };

    // max_tokens: floor at 16, default when omitted
    const mt = body.max_tokens as number | undefined;
    transformed.max_tokens = Math.max(MIN_MAX_TOKENS, mt ?? DEFAULT_MAX_TOKENS);

    if (body.temperature != null) transformed.temperature = body.temperature;
    if (body.top_p != null) transformed.top_p = body.top_p;

    // stop: must be an array
    if (body.stop != null) {
      transformed.stop = Array.isArray(body.stop) ? body.stop : [body.stop];
    }

    return transformed;
  }

  /**
   * Synthesize token usage from the response. AI Horde returns `{"kudos": N}`
   * instead of token counts — we estimate from message content lengths.
   */
  private synthesizeUsage(body: Record<string, unknown>, data: Record<string, unknown>): void {
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
      const response = await proxyAwareFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(transformedBody),
        signal: mergedSignal,
      }, proxyOptions as null);

      clearTimeout(connectTimer);

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        const { message } = this.parseError(response, errText);
        throw new Error(`AI Horde API error ${response.status}: ${message}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      this.synthesizeUsage(body, data);

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
    const finishReason = (choice?.finish_reason as string) || "stop";
    const id = (data.id as string) || `chatcmpl-${Date.now()}`;
    const created = (data.created as number) || Math.floor(Date.now() / 1000);

    const chunks = [
      // Role delta
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
      // Content delta
      ...(content ? [`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`] : []),
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

export default AIHordeExecutor;
