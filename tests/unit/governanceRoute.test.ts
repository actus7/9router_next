import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `propose_harness_capability` is how the agent asks to turn a plugin on or
 * off. It is always gated, so the only question is who is asking — and that
 * used to come from `body.source`, which is the caller telling the gate which
 * side of it to be on.
 */

vi.mock("@/server/application/http/requireDashboardAccess", () => ({
  requireDashboardAccess: vi.fn(async () => null),
}));
vi.mock("@/server/application/http/requestRuntime", () => ({
  assertRequestRuntime: vi.fn(async () => {}),
}));

const applyPluginToggle = vi.hoisted(() =>
  vi.fn(async (_input: { pluginId: string; enabled: boolean; source: string }) => ({ ok: true, pending: true })),
);

vi.mock("@/server/harness/governance/applyPluginWrite", () => ({
  applyPluginToggle,
  proposeHarnessCapability: vi.fn(async () => ({ ok: true })),
}));

import { NextRequest } from "next/server";
import { POST } from "@/server/application/use-cases/http/harness/governance/route";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/harness/governance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/harness/governance", () => {
  it("records the write as agent-initiated whatever the body claims", async () => {
    await POST(post({ action: "toggle", plugin_id: "tool-memory", enabled: false, source: "ui" }));

    expect(applyPluginToggle).toHaveBeenCalledOnce();
    expect(applyPluginToggle.mock.calls[0]?.[0]).toMatchObject({
      pluginId: "tool-memory",
      enabled: false,
      source: "agent",
    });
  });

  it("still requires a plugin to act on", async () => {
    const response = await POST(post({ action: "toggle", enabled: false }));

    expect(response.status).toBe(400);
    expect(applyPluginToggle).not.toHaveBeenCalled();
  });
});
