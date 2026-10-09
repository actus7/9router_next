import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import { getFirstByteBudget } from "@/server/llm-gateway/engine/utils/firstByteGuard";
import { handleStreamingResponse } from "@/server/llm-gateway/engine/handlers/chatCore/streamingHandler";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const ok = () => new Response("{}", { status: 200 });
const fail = (status: number) => new Response(JSON.stringify({ error: { message: "x" } }), { status });

describe("combo latency budgets", () => {
  it("arms the first-byte budget only while another candidate is waiting", async () => {
    const body: Record<string, unknown> = {};
    const seen: Array<number | undefined> = [];
    await handleComboChat({
      body,
      models: ["a/m", "b/m", "c/m"],
      handleSingleModel: async (b, m) => {
        seen.push(getFirstByteBudget(b));
        return m === "c/m" ? ok() : fail(503);
      },
      log,
      autoSwitch: false,
      comboFirstByteBudgetMs: 4321,
    });
    expect(seen).toEqual([4321, 4321, undefined]);
    expect(getFirstByteBudget(body)).toBeUndefined();
  });

  it("stops starting attempts once the time budget is spent, but always makes the first", async () => {
    const tried: string[] = [];
    const res = await handleComboChat({
      body: {},
      models: ["a/m", "b/m", "c/m"],
      handleSingleModel: async (_b, m) => {
        tried.push(m);
        await new Promise((r) => setTimeout(r, 25));
        return fail(503);
      },
      log,
      autoSwitch: false,
      comboTimeBudgetMs: 10,
    });
    expect(tried).toEqual(["a/m"]);
    expect(res.status).toBe(503);
  });

  it("still tries the first model with a zero-ish budget", async () => {
    const res = await handleComboChat({
      body: {},
      models: ["a/m"],
      handleSingleModel: async () => ok(),
      log,
      autoSwitch: false,
      comboTimeBudgetMs: 1,
    });
    expect(res.ok).toBe(true);
  });
});

describe("handleStreamingResponse first-byte guard", () => {
  function silentUpstream(onCancel: () => void): Response {
    const stream = new ReadableStream<Uint8Array>({ start() {}, cancel: onCancel });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  it("fails the attempt (504) instead of reporting success, and never marks the account healthy", async () => {
    const onCancel = vi.fn();
    const onRequestSuccess = vi.fn();
    const body: Record<string, unknown> = {};
    // Same body object the combo loop arms.
    const { setFirstByteBudget } = await import("@/server/llm-gateway/engine/utils/firstByteGuard");
    setFirstByteBudget(body, 30);

    const result = (await handleStreamingResponse({
      providerResponse: silentUpstream(onCancel),
      provider: "p",
      model: "m",
      body,
      onRequestSuccess,
      streamController: { handleError: vi.fn() },
      log: undefined,
    } as unknown as Parameters<typeof handleStreamingResponse>[0])) as { success: boolean; status?: number; error?: string; response: Response };

    expect(result.success).toBe(false);
    expect(result.status).toBe(504);
    expect(result.error).toContain("first-chunk timeout");
    expect(result.response.status).toBe(504);
    expect(onCancel).toHaveBeenCalled();
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
});
