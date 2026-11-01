import { beforeEach, describe, expect, it } from "vitest";
import { withTenant } from "@/lib/db/tenant";
import { getRotatedModels, resetComboRotation } from "@/server/llm-gateway/engine/services/combo";
import {
  MAX_ROUTING_HISTORY,
  recordRoutingTier,
  routingHistorySizeForTests,
  scoreRoutingRequest,
} from "@/server/llm-gateway/engine/services/smart-routing/scoring";

const MODELS = ["a", "b", "c"];
const rotate = (tenant: string) => withTenant(tenant, () => getRotatedModels(MODELS, "coding", "round-robin", 1));
const body = { messages: [{ role: "user", content: "please tell me about the weather today" }] };

describe("gateway in-memory state is scoped by tenant", () => {
  beforeEach(() => {
    for (const tenant of ["tenant-a", "tenant-b"]) withTenant(tenant, () => resetComboRotation());
  });

  it("keeps the combo rotation cursor per tenant", () => {
    expect(rotate("tenant-a")[0]).toBe("a");
    expect(rotate("tenant-a")[0]).toBe("b");
    expect(rotate("tenant-b")[0]).toBe("a");
  });

  it("resetComboRotation only resets the current tenant", () => {
    rotate("tenant-a");
    rotate("tenant-a");
    withTenant("tenant-b", () => resetComboRotation("coding"));
    expect(rotate("tenant-a")[0]).toBe("c");
  });

  it("does not leak routing momentum across tenants", () => {
    const baseline = scoreRoutingRequest(body, "general");
    withTenant("tenant-a", () => recordRoutingTier("s1", "reasoning"));
    const other = withTenant("tenant-b", () => scoreRoutingRequest(body, "general", "s1"));
    const same = withTenant("tenant-a", () => scoreRoutingRequest(body, "general", "s1"));
    expect(other.score).toBe(baseline.score);
    expect(same.score).not.toBe(baseline.score);
  });

  it("caps the routing history size", () => {
    for (let i = 0; i < MAX_ROUTING_HISTORY + 10; i++) recordRoutingTier(`session-${i}`, "simple");
    expect(routingHistorySizeForTests()).toBeLessThanOrEqual(MAX_ROUTING_HISTORY);
  });
});
