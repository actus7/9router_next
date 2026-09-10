import "server-only";

import { waitUntil } from "@vercel/functions";

import { currentTenantId, withTenant } from "@/lib/db/tenant";
import {
  createHarnessRun,
  settleHarnessRun,
  updateHarnessRunProgress,
} from "@/lib/db/repos/harnessRunsRepo";
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
}

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
      await settleHarnessRun(runId, {
        status: "completed",
        partialText: typeof message?.content === "string" ? message.content : "",
        usage: (data.usage as Record<string, unknown> | undefined) ?? null,
      });
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
    await settleHarnessRun(runId, {
      status: "completed",
      partialText: parsed.text,
      reasoning: parsed.reasoning || null,
      toolCalls: parsed.toolCalls,
      usage: (parsed.usage as Record<string, unknown> | null) ?? null,
    });
  } catch (error) {
    // Whatever went wrong, the row must stop saying "running" — a reader that
    // comes back tomorrow has no other way to learn this run is over.
    await settleHarnessRun(runId, {
      status: "failed",
      error: truncateTraceError(error) ?? "The run failed.",
    }).catch(() => undefined);
  }
}
