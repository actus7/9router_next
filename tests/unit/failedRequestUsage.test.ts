import { beforeEach, describe, expect, it, vi } from "vitest";

const saveRequestUsage = vi.fn(async () => 1);
vi.mock("@/lib/usageDb", () => ({ saveRequestUsage: (...a: unknown[]) => saveRequestUsage(...(a as [])) }));

import { recordFailedRequest } from "@/server/llm-gateway/application/failedRequestUsage";
import { recordRoutingStep, startRoutingTrace } from "@/server/llm-gateway/engine/services/routingTrace";

function failed(status = 503): Response {
  return new Response("{}", { status });
}

describe("recordFailedRequest", () => {
  beforeEach(() => saveRequestUsage.mockClear());

  it("writes a failed usage row carrying the attempts", async () => {
    const body = startRoutingTrace({} as Record<string, unknown>, "dev");
    recordRoutingStep(body, { kind: "attempt", model: "zai/glm", index: 1, total: 2, outcome: "failed", status: 429 });
    recordRoutingStep(body, { kind: "attempt", model: "oc/x", index: 2, total: 2, outcome: "failed", status: 503 });

    await recordFailedRequest({ body, response: failed(), requested: "dev", endpoint: "/v1/chat/completions", apiKey: "k" });

    expect(saveRequestUsage).toHaveBeenCalledTimes(1);
    const entry = (saveRequestUsage.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(entry.status).toBe("failed");
    expect(entry.model).toBe("dev");
    expect(entry.provider).toBe("oc");
    expect(entry.meta.routing.attempts).toHaveLength(2);
    expect(entry.meta.routing.failed).toBe(2);
  });

  it("does nothing for a successful response", async () => {
    const body = startRoutingTrace({} as Record<string, unknown>, "dev");
    await recordFailedRequest({ body, response: new Response("{}", { status: 200 }), requested: "dev", endpoint: "/x", apiKey: null });
    expect(saveRequestUsage).not.toHaveBeenCalled();
  });

  it("never throws when persistence fails", async () => {
    saveRequestUsage.mockRejectedValueOnce(new Error("db down"));
    const body = startRoutingTrace({} as Record<string, unknown>, "dev");
    await expect(recordFailedRequest({ body, response: failed(), requested: "dev", endpoint: "/x", apiKey: null })).resolves.toBeUndefined();
  });
});
