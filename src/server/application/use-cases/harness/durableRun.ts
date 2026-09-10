import "server-only";

import { waitUntil } from "@vercel/functions";

import { currentTenantId, withTenant } from "@/lib/db/tenant";
import {
  createHarnessRun,
  settleHarnessRun,
  updateHarnessRunProgress,
} from "@/lib/db/repos/harnessRunsRepo";
import { appendHarnessEvent, appendRunAnswerToConversation } from "@/lib/db/repos/harnessConversationsRepo";
import { runServerToolLoop } from "@/server/harness/tools/serverToolLoop";
import { resolveApiKeyOwner } from "@/lib/db/repos/apiKeysRepo";
import { handleChat } from "@/server/llm-gateway/chat";
import { initTranslators } from "@/server/llm-gateway/translator";
import { StreamChunkAccumulator } from "@/shared/chat/streamChunk";
import { truncateTraceError } from "@/shared/observability/routingTrace";

/**
 * How often the run's text is written back while the provider streams.
 *
 * Every token would be one UPDATE per token against Neon. Nothing reads the
 * row faster than a person can read prose, so the interval is set by what a
 * returning reader can stand to lose, not by the token rate.
 */
const PROGRESS_INTERVAL_MS = 1_000;

/**
 * Shown after the text of a tool turn that no browser was there to continue.
 *
 * Server-side and therefore untranslated, like the other messages this file
 * writes into a run (`"The run failed."`). It reaches the user through the
 * message body, which is rendered verbatim.
 */
const TOOL_TURN_INTERRUPTED =
  "Stopped here: this turn ran out of tool steps or of time. Send another message to continue.";

/**
 * How often the run is touched even when the provider has sent nothing.
 *
 * Without this there is no way to tell a worker that died from a provider
 * still thinking: both look like a row that has not changed. A reader would
 * have to assume the slowest case and wait it out, which is how a killed
 * worker used to leave the composer disabled for minutes. A heartbeat makes
 * silence mean death, and lets `STALE_RUN_MS` be short.
 */
const HEARTBEAT_INTERVAL_MS = 5_000;

let translatorsReady = false;

async function ensureTranslators(): Promise<void> {
  if (translatorsReady) return;
  await initTranslators();
  translatorsReady = true;
}

export interface StartDurableRunInput {
  sessionId: string;
  messageId: string;
  /** The OpenAI-shaped chat body the browser would have posted itself. */
  body: Record<string, unknown>;
  /** Passed straight through, because the gateway still authenticates the call. */
  authorization: string | null;
  /**
   * Skills this session has enabled, so `load_skill` keeps its scope.
   *
   * Stated by the client rather than derived here: part of the answer lives in
   * the browser's `localStorage` preferences, so the worker guessing it would
   * either widen the scope or narrow it.
   */
  enabledSkillIds?: readonly string[];
}

/**
 * How long the worker gives itself, against the platform's `maxDuration`.
 *
 * One run — every tool step included — has to finish inside one invocation.
 * The tool loop can wait on a video job, and a poll that ran to its own 90s
 * timeout eight times over would be killed by the platform mid-step: the row
 * stays `running` and the next reader settles it as dead, losing everything
 * accumulated. So the loop is given a deadline short of the ceiling and stops
 * itself in a state it can report.
 */
const RUN_BUDGET_MS = 240_000;

/**
 * Starts a chat run that does not depend on the caller staying connected.
 *
 * The HTTP response is sent as soon as the row exists; the provider call runs
 * afterwards under `waitUntil`, which is what keeps the serverless invocation
 * alive past the response. Nothing here reads the request's abort signal — the
 * browser going away is the case this exists for.
 */
export async function startDurableRun(input: StartDurableRunInput): Promise<{ runId: string }> {
  const runId = globalThis.crypto.randomUUID();
  const model = typeof input.body.model === "string" ? input.body.model : null;

  await createHarnessRun({
    id: runId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    model,
  });

  // Captured now, inside the request's tenant context. The worker below runs
  // after the response, where the ambient tenant is whatever the next request
  // happens to establish.
  const owner = currentTenantId();
  waitUntil(withTenant(owner, () => executeRun(runId, input)));

  return { runId };
}

/**
 * The caller's API key, but only if the caller actually owns it.
 *
 * The gateway checks a key by asking whether it exists *anywhere*, not whether
 * it belongs to whoever sent it — normally `gatewayRoute` covers that, by
 * deriving the tenant from the key itself. This path does not go through
 * `gatewayRoute` (the tenant comes from the dashboard session), so forwarding
 * the header unchecked would let any signed-in account satisfy the gateway's
 * `requireApiKey` gate with somebody else's key. No tenant escalation — every
 * write and every credential lookup is pinned to `withTenant(owner)` — but a
 * gate that anyone can satisfy is not a gate.
 */
async function ownedAuthorization(header: string | null, owner: string): Promise<string | null> {
  if (!header) return null;
  const key = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : header.trim();
  if (!key) return null;
  const keyOwner = await resolveApiKeyOwner(key).catch(() => null);
  return keyOwner?.userId === owner ? header : null;
}

async function executeRun(runId: string, input: StartDurableRunInput): Promise<void> {
  const startedAt = Date.now();
  try {
    await ensureTranslators();

    const authorization = await ownedAuthorization(input.authorization, currentTenantId());
    const request = new Request("http://durable-run.local/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({ ...input.body, stream: true, stream_options: { include_usage: true } }),
    });

    const response = await handleChat(request);
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = detail.error ?? detail.message;
      await settleHarnessRun(runId, {
        status: "failed",
        error:
          truncateTraceError(
            typeof error === "string"
              ? error
              : typeof (error as Record<string, unknown> | undefined)?.message === "string"
                ? String((error as Record<string, unknown>).message)
                : "",
          ) ?? `Request failed (${response.status})`,
      });
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      // A provider that answered without streaming: the whole body is the answer.
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const choice = (data.choices as Array<Record<string, unknown>> | undefined)?.[0];
      const message = choice?.message as Record<string, unknown> | undefined;
      const text = typeof message?.content === "string" ? message.content : "";
      const settled = await settleHarnessRun(runId, {
        status: "completed",
        partialText: text,
        usage: (data.usage as Record<string, unknown> | undefined) ?? null,
      });
      if (settled) {
        await mirrorAnswer(input, { content: text, status: "done" });
      }
      return;
    }

    const decoder = new TextDecoder();
    const accumulator = new StreamChunkAccumulator();
    let lastWrite = 0;

    // Runs alongside the read loop: a provider that thinks for a minute before
    // its first token must not look like a worker that died.
    const heartbeat = setInterval(() => {
      // Skip when the read loop just wrote: two writers on one row can land out
      // of order, and the loser rewinds `partialText` for whoever is reading.
      if (Date.now() - lastWrite < HEARTBEAT_INTERVAL_MS) return;
      lastWrite = Date.now();
      void updateHarnessRunProgress(runId, accumulator.result().text).catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!accumulator.push(decoder.decode(value, { stream: true }))) continue;
        const now = Date.now();
        if (now - lastWrite < PROGRESS_INTERVAL_MS) continue;
        lastWrite = now;
        if (await updateHarnessRunProgress(runId, accumulator.result().text)) continue;
        // The row stopped being `running` under us: someone pressed stop. Drop
        // the provider connection and leave the row exactly as they set it.
        await reader.cancel().catch(() => undefined);
        return;
      }
    } finally {
      clearInterval(heartbeat);
    }

    const parsed = accumulator.finish(decoder.decode());

    // The tool loop runs here now, not in the browser. Anything it cannot run
    // this side comes back in `leftoverToolCalls` and is settled onto the row,
    // which is where `executeDurableChat` reads tool calls from — so a browser
    // picks up exactly those and never re-runs what this side already did.
    const loop = parsed.toolCalls.length
      ? await runServerToolLoop({
          body: input.body,
          authorization,
          sessionId: input.sessionId,
          model: typeof input.body.model === "string" ? input.body.model : null,
          deadline: startedAt + RUN_BUDGET_MS,
          enabledSkillIds: input.enabledSkillIds,
          firstTurnText: parsed.text,
          firstTurnToolCalls: parsed.toolCalls,
          onProgress: (text) => updateHarnessRunProgress(runId, text),
          onToolEvent: async (type, data) => {
            // Best effort: the journal is observability, and failing to write
            // it must not fail a run that is otherwise going fine.
            await appendHarnessEvent({
              sessionId: input.sessionId,
              type,
              data: { runId: input.messageId, ...data },
            }).catch(() => undefined);
          },
        })
      : null;

    const finalText = loop ? loop.text : parsed.text;
    const finalToolCalls = loop ? loop.leftoverToolCalls : parsed.toolCalls;
    const settled = await settleHarnessRun(runId, {
      status: "completed",
      partialText: finalText,
      reasoning: (loop?.reasoning || parsed.reasoning) || null,
      toolCalls: finalToolCalls,
      usage: (loop?.usage ?? (parsed.usage as Record<string, unknown> | null)) ?? null,
    });
    if (settled) {
      // A turn that asked for tools is not finished: the loop that continues it
      // runs in the browser, so a closed tab stops it here. It is still
      // mirrored — leaving it only in `harnessRuns` meant it expired after
      // `SETTLED_RUN_TTL_MS` with nothing said — but as `error`, because
      // writing it as `done` would file a truncated turn as a complete answer.
      // Its unanswered calls ride along and are dropped when the conversation
      // is next serialized (`buildRequestMessages`).
      const unfinished = finalToolCalls.length > 0;
      await mirrorAnswer(input, {
        content: unfinished && finalText
          ? `${finalText}

_${TOOL_TURN_INTERRUPTED}_`
          : finalText,
        status: unfinished ? "error" : "done",
        reasoning: (loop?.reasoning || parsed.reasoning) || null,
        toolCalls: unfinished ? finalToolCalls : undefined,
        tokenUsage: (loop?.usage ?? (parsed.usage as Record<string, unknown> | null)) ?? null,
      });
    }
  } catch (error) {
    // Whatever went wrong, the row must stop saying "running" — a reader that
    // comes back tomorrow has no other way to learn this run is over.
    const message = truncateTraceError(error) ?? "The run failed.";
    const settled = await settleHarnessRun(runId, { status: "failed", error: message }).catch(() => false);
    if (settled) {
      await mirrorAnswer(input, { content: `Error: ${message}`, status: "error" });
    }
  }
}

/**
 * Mirrors a settled run's answer into the conversation itself.
 *
 * Without this the answer lived only in `harnessRuns`, waiting for a browser to
 * come back and fold it in — and only into the session that happened to be
 * open. Settled rows expire after `SETTLED_RUN_TTL_MS`, so a laptop closed for
 * a day lost an answer the account had already paid for. Best-effort on
 * purpose: the run row is still the record, and failing here must not turn a
 * finished run into a failed one.
 */
async function mirrorAnswer(
  input: StartDurableRunInput,
  patch: Parameters<typeof appendRunAnswerToConversation>[2],
): Promise<void> {
  await appendRunAnswerToConversation(input.sessionId, input.messageId, patch).catch(() => false);
}
