import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import { getRoutingTrace, startRoutingTrace } from "@/server/llm-gateway/engine/services/routingTrace";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function attemptsOf(body: Record<string, unknown>) {
  return getRoutingTrace(body)!.steps.filter((s) => s.kind === "attempt");
}

describe("handleComboChat attempt trace", () => {
  it("records one attempt per model, including the one that answered", async () => {
    const body = startRoutingTrace({ messages: [] } as Record<string, unknown>, "dev");
    const answers: Record<string, () => Response> = {
      "zai/glm": () => json(429, { error: { message: "rate limit" } }),
      "oc/free": () => json(400, { error: { message: "Bad request" } }),
      "mimo/flash": () => json(200, { ok: true }),
    };
    const res = await handleComboChat({
      body,
      models: Object.keys(answers),
      handleSingleModel: async (_b, m) => answers[m](),
      log,
      comboName: "dev",
      autoSwitch: false,
    });
    expect(res.ok).toBe(true);
    const attempts = attemptsOf(body) as Array<Record<string, unknown>>;
    expect(attempts.map((a) => [a.model, a.outcome, a.status])).toEqual([
      ["zai/glm", "failed", 429],
      ["oc/free", "failed", 400],
      ["mimo/flash", "ok", 200],
    ]);
    expect(attempts[0].errorClass).toBe("rate_limit");
    expect(attempts[0].error).toContain("rate limit");
    for (const a of attempts) {
      expect(typeof a.durationMs).toBe("number");
      expect(typeof a.startOffsetMs).toBe("number");
    }
  });

  it("marks a model skipped by cooldown as cooldown_skip", async () => {
    const body = startRoutingTrace({} as Record<string, unknown>, "dev");
    const retryAfter = new Date(Date.now() + 60_000).toISOString();
    const res = await handleComboChat({
      body,
      models: ["a/m", "b/m"],
      handleSingleModel: async (_b, m) =>
        m === "a/m" ? json(429, { error: { message: "all accounts locked" }, retryAfter }) : json(200, {}),
      log,
      autoSwitch: false,
    });
    expect(res.ok).toBe(true);
    expect((attemptsOf(body)[0] as { outcome: string }).outcome).toBe("cooldown_skip");
  });

  it("records a thrown error as aborted with its class", async () => {
    const body = startRoutingTrace({} as Record<string, unknown>, "dev");
    await handleComboChat({
      body,
      models: ["a/m", "b/m"],
      handleSingleModel: async (_b, m) => {
        if (m === "a/m") throw new Error("fetch connect timeout");
        return json(200, {});
      },
      log,
      autoSwitch: false,
    });
    const first = attemptsOf(body)[0] as { outcome: string; errorClass: string };
    expect(first.outcome).toBe("aborted");
    expect(first.errorClass).toBe("timeout");
  });

  it("all-failed response names each model's outcome", async () => {
    const body = startRoutingTrace({} as Record<string, unknown>, "dev");
    const res = await handleComboChat({
      body,
      models: ["a/m", "b/m"],
      handleSingleModel: async () => json(503, { error: { message: "down" } }),
      log,
      autoSwitch: false,
    });
    expect(res.status).toBe(503);
    const payload = await res.json();
    expect(payload.error.message).toContain("a/m");
    expect(payload.error.message).toContain("b/m");
  });
});
