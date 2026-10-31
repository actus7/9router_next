import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import { getRoutingTrace, startRoutingTrace } from "@/server/llm-gateway/engine/services/routingTrace";

/**
 * A member that rejects THIS request (validation, payload size, context length)
 * says nothing about the next member, which runs on another provider with other
 * limits. The combo must advance past it, return the real status when nobody
 * serves the request, and never let a 4xx from one member end the loop.
 */
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("combo advances past a request-scoped 4xx from a member", () => {
  it.each([
    ["validation", 400, "Request validation failed"],
    ["payload too large", 413, "Request entity too large"],
    ["unprocessable", 422, "Unsupported parameter: response_format"],
  ])("serves from the next member after a %s error", async (_label, status, message) => {
    const handleSingleModel = vi.fn(async (_b, m: string) =>
      m === "a/m" ? json(status, { error: { message } }) : json(200, { choices: [] }));

    const res = await handleComboChat({
      body: { messages: [] },
      models: ["a/m", "b/m"],
      handleSingleModel,
      log,
      autoSwitch: false,
    });

    expect(res.status).toBe(200);
    expect(handleSingleModel.mock.calls.map(([, m]) => m)).toEqual(["a/m", "b/m"]);
  });

  it("returns the real status and the last message when every member rejects the request", async () => {
    const body = startRoutingTrace({ messages: [] } as Record<string, unknown>, "dev");
    const res = await handleComboChat({
      body,
      models: ["a/m", "b/m"],
      handleSingleModel: async (_b, m: string) =>
        json(400, { error: { message: m === "a/m" ? "first reason" : "second reason" } }),
      log,
      comboName: "dev",
      autoSwitch: false,
    });

    expect(res.status).toBe(400);
    const message = ((await res.json()) as { error: { message: string } }).error.message;
    expect(message).toContain("second reason");
    const attempts = getRoutingTrace(body)!.steps.filter((s) => s.kind === "attempt");
    expect(attempts.map((a) => [a.model, a.outcome, a.status])).toEqual([
      ["a/m", "failed", 400],
      ["b/m", "failed", 400],
    ]);
  });
});
