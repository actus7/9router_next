// A streaming answer is handed to the client as a success the moment the
// upstream sends headers, so a model that then sits silent for minutes cannot
// be failed over from: the combo has already returned. This waits for the first
// upstream chunk (bounded) before that hand-off, so a silent model counts as a
// failed attempt and the combo can move on.
//
// Only worth doing when another candidate exists: a solo model has nowhere to
// fall to, and a reasoning model may legitimately think for a long while.

const FIRST_BYTE_BUDGET = Symbol.for("routerx.firstbyte.budget");

type BudgetBody = Record<string | symbol, unknown>;

/** Set by the combo loop, read by the streaming handler. undefined = no guard. */
export function setFirstByteBudget(body: Record<string, unknown> | null | undefined, ms: number | undefined): void {
  if (!body) return;
  if (ms === undefined) delete (body as BudgetBody)[FIRST_BYTE_BUDGET];
  else (body as BudgetBody)[FIRST_BYTE_BUDGET] = ms;
}

export function getFirstByteBudget(body: Record<string, unknown> | null | undefined): number | undefined {
  const value = body ? (body as BudgetBody)[FIRST_BYTE_BUDGET] : undefined;
  return typeof value === "number" && value > 0 ? value : undefined;
}

const ATTEMPT_SIGNAL = Symbol.for("routerx.attempt.signal");

/**
 * Set by the combo on the per-attempt copy of the body when two attempts may run
 * at once: aborted when the other one won, so this one stops reading (and
 * paying for) its upstream. Not set outside a hedge.
 */
export function setAttemptSignal(body: Record<string, unknown> | null | undefined, signal: AbortSignal | undefined): void {
  if (!body) return;
  if (signal === undefined) delete (body as BudgetBody)[ATTEMPT_SIGNAL];
  else (body as BudgetBody)[ATTEMPT_SIGNAL] = signal;
}

export function getAttemptSignal(body: Record<string, unknown> | null | undefined): AbortSignal | undefined {
  const value = body ? (body as BudgetBody)[ATTEMPT_SIGNAL] : undefined;
  return value instanceof AbortSignal ? value : undefined;
}

export type FirstChunkResult =
  | { ok: true; response: Response }
  | { ok: false; aborted?: boolean };

const TIMED_OUT = Symbol("first-chunk-timeout");
const ABORTED = Symbol("first-chunk-aborted");

/**
 * Wait up to `budgetMs` for the first upstream chunk. On time, answer an
 * equivalent response that replays that chunk and then the rest, so nothing is
 * lost or reordered. Out of time, cancel the upstream (which aborts the fetch)
 * and answer `ok: false`.
 *
 * An upstream that ends empty or errors before the budget is not a timeout:
 * those are passed through for the existing handling to report.
 */
export async function awaitFirstChunk(response: Response, budgetMs: number, signal?: AbortSignal): Promise<FirstChunkResult> {
  if (!response.body) return { ok: true, response };
  const reader = response.body.getReader();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<typeof TIMED_OUT | typeof ABORTED>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
    if (signal?.aborted) resolve(ABORTED);
    else if (signal) signal.addEventListener("abort", onAbort = () => resolve(ABORTED), { once: true });
  });
  const first = reader.read().then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  const winner = await Promise.race([first, timeout]);
  clearTimeout(timer);
  if (onAbort) signal?.removeEventListener("abort", onAbort);

  if (winner === TIMED_OUT || winner === ABORTED) {
    reader.cancel().catch(() => {});
    return winner === ABORTED ? { ok: false, aborted: true } : { ok: false };
  }

  const replay = new ReadableStream<Uint8Array>({
    start(controller) {
      if ("error" in winner) return controller.error(winner.error);
      if (winner.value.done) return controller.close();
      controller.enqueue(winner.value.value);
    },
    async pull(controller) {
      if ("error" in winner || winner.value.done) return;
      try {
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return {
    ok: true,
    response: new Response(replay, { status: response.status, statusText: response.statusText, headers: response.headers }),
  };
}
