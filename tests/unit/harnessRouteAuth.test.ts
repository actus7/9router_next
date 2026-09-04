import { beforeEach, describe, expect, it, vi } from "vitest";

// Route handlers mark themselves request-time dynamic, and Next's connection()
// throws when called outside a request scope, which is where a unit test lives.
vi.mock("@/server/application/http/requestRuntime", () => ({
  assertRequestRuntime: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/dashboardAccess", () => ({
  hasDashboardAccess: vi.fn(),
}));
vi.mock("@/server/plugin-core/sandbox/runSandboxCapability", () => ({
  runSandboxCapability: vi.fn(async () => ({ ok: true, result: 42 })),
}));
vi.mock("@/server/harness/mcpClient", () => ({
  discoverMcpTools: vi.fn(async () => []),
}));

import { NextRequest } from "next/server";
import { hasDashboardAccess } from "@/lib/auth/dashboardAccess";
import { runSandboxCapability } from "@/server/plugin-core/sandbox/runSandboxCapability";
import { discoverMcpTools } from "@/server/harness/mcpClient";
import { POST } from "@/server/application/use-cases/http/harness/sandbox/eval/route";
import { POST as discoverPost } from "@/app/api/harness/mcp/discover/route";

function evalRequest(): NextRequest {
  return new NextRequest("http://localhost/api/harness/sandbox/eval", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "registerTool('t', () => 42)" }),
  });
}

describe("harness route auth gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses to run sandboxed code for an unauthenticated caller", async () => {
    vi.mocked(hasDashboardAccess).mockResolvedValue(false);

    const response = await POST(evalRequest());

    expect(response.status).toBe(401);
    expect(runSandboxCapability).not.toHaveBeenCalled();
  });

  it("runs sandboxed code once the caller holds dashboard access", async () => {
    vi.mocked(hasDashboardAccess).mockResolvedValue(true);

    const response = await POST(evalRequest());

    expect(response.status).toBe(200);
    expect(runSandboxCapability).toHaveBeenCalledTimes(1);
  });
});

function discoverRequest(): NextRequest {
  return new NextRequest("http://localhost/api/harness/mcp/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://mcp.example.com/sse", authToken: "t" }),
  });
}

/**
 * Discovery takes a URL and a token straight from the caller and makes the
 * server open an outbound session with them. Its sibling `mcp/call` gates that
 * on owner authority; this one has to as well, or the guard is only half
 * applied to the pair.
 */
describe("mcp discovery auth gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses to reach the supplied URL for an unauthenticated caller", async () => {
    vi.mocked(hasDashboardAccess).mockResolvedValue(false);

    const response = await discoverPost(discoverRequest());

    expect(response.status).toBe(401);
    expect(discoverMcpTools).not.toHaveBeenCalled();
  });

  it("discovers tools once the caller holds dashboard access", async () => {
    vi.mocked(hasDashboardAccess).mockResolvedValue(true);

    const response = await discoverPost(discoverRequest());

    expect(response.status).toBe(200);
    expect(discoverMcpTools).toHaveBeenCalledWith("https://mcp.example.com/sse", "t");
  });
});
