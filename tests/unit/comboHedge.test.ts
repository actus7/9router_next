import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import { clearModelPenalties, getModelPenalty } from "@/server/llm-gateway/engine/services/modelPenalty";
import { getRoutingTrace, startRoutingTrace } from "@/server/llm-gateway/engine/services/routingTrace";
import { getAttemptSignal, getFirstByteBudget } from "@/server/llm-gateway/engine/utils/firstByteGuard";
import { setModelStatsStore, type AttemptDatum } from "@/server/llm-gateway/engine/host/modelStats";
import { STREAM_FIRST_CHUNK_TIMEOUT_MS } from "@/server/llm-gateway/engine/config/runtimeConfig";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Plan {
  delay: number;
  result?: "ok" | "fail" | "client";
  /** A loser that does not notice the abort and still answers ok (the real race). */
  ignoreAbort?: boolean;
}

/** An upstream whose stream records when it is cancelled. */
function okResponse(label: string, onCancel: () => void): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(label));
      c.close();
    },
    cancel: onCancel,
  });
  return new Response(stream, { status: 200 });
}

function harness(plans: Record<string, Plan>) {
  const calls: string[] = [];
  const timeline: string[] = [];
  const signals = new Map<string, AbortSignal | undefined>();
  const cancelled: string[] = [];
  const budgets = new Map<string, number | undefined>();
  let inFlight = 0;
  let maxInFlight = 0;

  const handleSingleModel = async (b: Record<string, unknown>, m: string): Promise<Response> => {
    const plan = plans[m] ?? { delay: 1 };
    calls.push(m);
    timeline.push(`start ${m}`);
    budgets.set(m, getFirstByteBudget(b));
    const signal = getAttemptSignal(b);
    signals.set(m, signal);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const aborted = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), plan.delay);
        if (signal && !plan.ignoreAbort) {
          signal.addEventListener("abort", () => { clearTimeout(timer); resolve(true); }, { once: true });
        }
      });
      timeline.push(`end ${m}`);
      if (aborted) return new Response(JSON.stringify({ error: { message: "aborted" } }), { status: 499 });
      if (plan.result === "client") return new Response(JSON.stringify({ error: { message: "unsupported parameter" } }), { status: 400 });
      if (plan.result === "fail") return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 503 });
      return okResponse(m, () => cancelled.push(m));
    } finally {
      inFlight--;
    }
  };

  return { handleSingleModel, calls, timeline, signals, cancelled, budgets, maxInFlight: () => maxInFlight };
}

async function run(
  h: ReturnType<typeof harness>,
  models: string[],
  extra: Record<string, unknown> = {},
  body: Record<string, unknown> = { stream: true },
) {
  startRoutingTrace(body, "dev");
  const res = await handleComboChat({
    body,
    models,
    handleSingleModel: h.handleSingleModel,
    log,
    comboName: "dev",
    autoSwitch: false,
    comboHedgeDelayMs: 30,
    ...extra,
  });
  return { res, body, trace: getRoutingTrace(body)!.steps };
}

describe("combo hedge", () => {
  let recorded: AttemptDatum[];
  beforeEach(() => {
    clearModelPenalties();
    recorded = [];
    setModelStatsStore({ record: (d) => recorded.push(d), read: async () => new Map() });
  });
  afterEach(() => setModelStatsStore(null));

  it("starts the next model when the first stays silent, and the faster one wins", async () => {
    const h = harness({ "slow/m": { delay: 400 }, "fast/m": { delay: 20 } });
    const { res, trace } = await run(h, ["slow/m", "fast/m"]);
    expect(await res.text()).toBe("fast/m");
    expect(h.signals.get("slow/m")?.aborted).toBe(true);
    expect(h.signals.get("fast/m")?.aborted).toBe(false);
    await sleep(20);
    const slowStep = trace.find((s) => s.kind === "attempt" && s.model === "slow/m");
    expect(slowStep).toMatchObject({ outcome: "aborted" });
  });

  it("lets a healthy primary win when the hedged model answers with an error that does not fall back", async () => {
    const h = harness({ "slow/m": { delay: 120 }, "picky/m": { delay: 20, result: "client" } });
    const { res } = await run(h, ["slow/m", "picky/m"]);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("slow/m");
    expect(h.signals.get("slow/m")?.aborted).toBe(false);
  });

  it("does not count the aborted loser as a failure of the model", async () => {
    const h = harness({ "slow/m": { delay: 400 }, "fast/m": { delay: 20 } });
    await run(h, ["slow/m", "fast/m"]);
    await sleep(20);
    expect(getModelPenalty("slow/m")).toBe(0);
    expect(recorded.map((d) => d.modelKey)).toEqual(["fast/m"]);
  });

  it("cancels the stream of a loser that answers after losing, so nothing stays open", async () => {
    const h = harness({ "slow/m": { delay: 150, ignoreAbort: true }, "fast/m": { delay: 20 } });
    const { res, trace } = await run(h, ["slow/m", "fast/m"]);
    expect(await res.text()).toBe("fast/m");
    await sleep(200);
    expect(h.cancelled).toEqual(["slow/m"]);
    expect(trace.find((s) => s.kind === "attempt" && s.model === "slow/m")).toMatchObject({ outcome: "aborted" });
    expect(recorded.map((d) => d.modelKey)).toEqual(["fast/m"]);
    expect(getModelPenalty("slow/m")).toBe(0);
  });

  it("keeps the first model when it answers before the hedge delay", async () => {
    const h = harness({ "a/m": { delay: 5 }, "b/m": { delay: 5 } });
    const { res } = await run(h, ["a/m", "b/m"]);
    expect(await res.text()).toBe("a/m");
    expect(h.calls).toEqual(["a/m"]);
  });

  it("falls through sequentially when the first model fails fast, without a hedge", async () => {
    const h = harness({ "dead/m": { delay: 5, result: "fail" }, "ok/m": { delay: 5 } });
    const { res } = await run(h, ["dead/m", "ok/m"]);
    expect(await res.text()).toBe("ok/m");
    expect(h.timeline).toEqual(["start dead/m", "end dead/m", "start ok/m", "end ok/m"]);
    expect(getModelPenalty("dead/m")).toBeGreaterThan(0);
  });

  it("goes on to the next candidate when both hedged models fail for real", async () => {
    const h = harness({
      "a/m": { delay: 80, result: "fail" },
      "b/m": { delay: 40, result: "fail" },
      "c/m": { delay: 5 },
    });
    const { res } = await run(h, ["a/m", "b/m", "c/m"]);
    expect(await res.text()).toBe("c/m");
    expect(h.calls).toEqual(["a/m", "b/m", "c/m"]);
    expect(getModelPenalty("a/m")).toBeGreaterThan(0);
    expect(getModelPenalty("b/m")).toBeGreaterThan(0);
  });

  it("waits for the first model when the hedge fails", async () => {
    const h = harness({ "a/m": { delay: 120 }, "b/m": { delay: 10, result: "fail" } });
    const { res } = await run(h, ["a/m", "b/m"]);
    expect(await res.text()).toBe("a/m");
    expect(h.signals.get("a/m")?.aborted).toBe(false);
  });

  it("reports the failure when every model fails", async () => {
    const h = harness({ "a/m": { delay: 60, result: "fail" }, "b/m": { delay: 10, result: "fail" } });
    const { res } = await run(h, ["a/m", "b/m"]);
    expect(res.status).toBe(503);
  });

  it("never runs more than two attempts at once", async () => {
    const h = harness({ "a/m": { delay: 150 }, "b/m": { delay: 150 }, "c/m": { delay: 150 } });
    await run(h, ["a/m", "b/m", "c/m"]);
    expect(h.maxInFlight()).toBe(2);
    expect(h.calls).not.toContain("c/m");
  });

  it("does not hedge a request that is not streaming", async () => {
    const h = harness({ "slow/m": { delay: 100 }, "fast/m": { delay: 5 } });
    const { res } = await run(h, ["slow/m", "fast/m"], {}, {});
    expect(await res.text()).toBe("slow/m");
    expect(h.calls).toEqual(["slow/m"]);
  });

  it("does not hedge a single-model combo", async () => {
    const h = harness({ "only/m": { delay: 100 } });
    const { res } = await run(h, ["only/m"]);
    expect(await res.text()).toBe("only/m");
    expect(h.calls).toEqual(["only/m"]);
  });

  it("is off when the combo says hedge: false, or the switch is off", async () => {
    for (const extra of [{ hedge: false }, { hedgeEnabled: false }]) {
      const h = harness({ "slow/m": { delay: 100 }, "fast/m": { delay: 5 } });
      const { res } = await run(h, ["slow/m", "fast/m"], extra);
      expect(await res.text()).toBe("slow/m");
      expect(h.calls).toEqual(["slow/m"]);
    }
  });

  it("does not start a hedge once the time budget is spent", async () => {
    const h = harness({ "slow/m": { delay: 100 }, "fast/m": { delay: 5 } });
    const { res } = await run(h, ["slow/m", "fast/m"], { comboTimeBudgetMs: 10 });
    expect(await res.text()).toBe("slow/m");
    expect(h.calls).toEqual(["slow/m"]);
  });

  it("gives each hedged attempt its own budget and leaves the shared body clean", async () => {
    const h = harness({ "x/claude-opus-5": { delay: 100 }, "last/m": { delay: 5 } });
    const { body } = await run(h, ["x/claude-opus-5", "last/m"], { comboFirstByteBudgetMs: 4321 });
    // A reasoning primary and a last model keep the long patience, but are guarded
    // so that "answered" means "sent a first byte" and not just "sent headers".
    expect(h.budgets.get("x/claude-opus-5")).toBe(STREAM_FIRST_CHUNK_TIMEOUT_MS);
    expect(h.budgets.get("last/m")).toBe(STREAM_FIRST_CHUNK_TIMEOUT_MS);
    expect(getFirstByteBudget(body)).toBeUndefined();
    expect(getAttemptSignal(body)).toBeUndefined();
  });
});

describe("hedge abort reaches the upstream", () => {
  const silentUpstream = (onCancel: () => void) =>
    new Response(new ReadableStream<Uint8Array>({ start() {}, cancel: onCancel }), { status: 200, headers: { "content-type": "text/event-stream" } });

  it("awaitFirstChunk stops waiting and cancels the upstream as soon as the attempt is aborted", async () => {
    const { awaitFirstChunk } = await import("@/server/llm-gateway/engine/utils/firstByteGuard");
    const onCancel = vi.fn();
    const controller = new AbortController();
    const pending = awaitFirstChunk(silentUpstream(onCancel), 60_000, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ ok: false, aborted: true });
    expect(onCancel).toHaveBeenCalled();
  });

  it("an aborted attempt is answered 499, never marks the account healthy, and is not a timeout", async () => {
    const { handleStreamingResponse } = await import("@/server/llm-gateway/engine/handlers/chatCore/streamingHandler");
    const { setFirstByteBudget, setAttemptSignal } = await import("@/server/llm-gateway/engine/utils/firstByteGuard");
    const onCancel = vi.fn();
    const onRequestSuccess = vi.fn();
    const handleDisconnect = vi.fn();
    const handleError = vi.fn();
    const controller = new AbortController();
    const body: Record<string, unknown> = {};
    setFirstByteBudget(body, 60_000);
    setAttemptSignal(body, controller.signal);

    const pending = handleStreamingResponse({
      providerResponse: silentUpstream(onCancel),
      provider: "p",
      model: "m",
      body,
      onRequestSuccess,
      streamController: { handleError, handleDisconnect },
      log: undefined,
    } as unknown as Parameters<typeof handleStreamingResponse>[0]) as Promise<{ success: boolean; status?: number; response: Response }>;
    controller.abort();
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.status).toBe(499);
    expect(result.response.status).toBe(499);
    expect(handleDisconnect).toHaveBeenCalledWith("hedge_lost");
    expect(handleError).not.toHaveBeenCalled();
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
  it("does not race a large prompt: the hedged model would read it all again, uncached", async () => {
    const h = harness({ "slow/m": { delay: 120 }, "fast/m": { delay: 5 } });
    const big = "x".repeat(4 * 40_000);
    const { res } = await run(h, ["slow/m", "fast/m"], { hedgeMaxPromptTokens: 32_000 }, { stream: true, messages: [{ role: "user", content: big }] });
    expect(await res.text()).toBe("slow/m");
    expect(h.calls).toEqual(["slow/m"]);
  });

  it("still races a small prompt", async () => {
    const h = harness({ "slow/m": { delay: 400 }, "fast/m": { delay: 5 } });
    const { res } = await run(h, ["slow/m", "fast/m"], { hedgeMaxPromptTokens: 32_000 }, { stream: true, messages: [{ role: "user", content: "hi" }] });
    expect(await res.text()).toBe("fast/m");
  });
});
