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

export type FirstChunkResult =
  | { ok: true; response: Response }
  | { ok: false };

const TIMED_OUT = Symbol("first-chunk-timeout");

/**
 * Wait up to `budgetMs` for the first upstream chunk. On time, answer an
 * equivalent response that replays that chunk and then the rest, so nothing is
 * lost or reordered. Out of time, cancel the upstream (which aborts the fetch)
 * and answer `ok: false`.
 *
 * An upstream that ends empty or errors before the budget is not a timeout:
 * those are passed through for the existing handling to report.
 */
export async function awaitFirstChunk(response: Response, budgetMs: number): Promise<FirstChunkResult> {
  if (!response.body) return { ok: true, response };
  const reader = response.body.getReader();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
  });
  const first = reader.read().then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  const winner = await Promise.race([first, timeout]);
  clearTimeout(timer);

  if (winner === TIMED_OUT) {
    reader.cancel().catch(() => {});
    return { ok: false };
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
