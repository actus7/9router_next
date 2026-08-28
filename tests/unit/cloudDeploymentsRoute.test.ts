import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/models", () => ({
  createCloudDeployment: vi.fn(),
  getCloudConnectionByProvider: vi.fn(),
  getCloudDeployments: vi.fn(),
}));
vi.mock("@/server/cloud/tools/registry", () => ({ getCloudTool: vi.fn() }));
vi.mock("@/server/cloud/providers/registry", () => ({ getCloudProviderDriver: vi.fn() }));
vi.mock("@/server/cloud/gatewayConfig", () => ({ resolveGatewayConfig: vi.fn() }));

import { POST } from "@/app/api/cloud/deployments/route";
import { createCloudDeployment, getCloudConnectionByProvider, getCloudDeployments } from "@/models";
import { getCloudTool } from "@/server/cloud/tools/registry";
import { getCloudProviderDriver } from "@/server/cloud/providers/registry";
import { resolveGatewayConfig } from "@/server/cloud/gatewayConfig";

function req(body: unknown): Request {
  return new Request("http://localhost/api/cloud/deployments", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/cloud/deployments", () => {
  it("rejects a toolId with no manifest", async () => {
    vi.mocked(getCloudProviderDriver).mockReturnValue({} as never);
    vi.mocked(getCloudTool).mockReturnValue(null);
    const res = await POST(req({ provider: "render", toolId: "codex", model: "gpt-4o", modelProvider: "openai", gatewayApiKey: "k" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects when there is no connection for the provider", async () => {
    vi.mocked(getCloudProviderDriver).mockReturnValue({} as never);
    vi.mocked(getCloudTool).mockReturnValue({ id: "openclaw", image: "img", port: 1 } as never);
    vi.mocked(getCloudConnectionByProvider).mockResolvedValue(null);
    const res = await POST(req({ provider: "render", toolId: "openclaw", model: "gpt-4o", modelProvider: "openai", gatewayApiKey: "k" }) as never);
    expect(res.status).toBe(400);
  });

  it("creates a deployment end to end", async () => {
    vi.mocked(getCloudTool).mockReturnValue({ id: "openclaw", image: "img", port: 10000 } as never);
    vi.mocked(getCloudConnectionByProvider).mockResolvedValue({ id: "conn1", token: "tok" } as never);
    vi.mocked(getCloudDeployments).mockResolvedValue([]);
    vi.mocked(resolveGatewayConfig).mockResolvedValue({ gatewayApiUrl: "https://squid.example.com/v1", apiKeys: [] });
    vi.mocked(getCloudProviderDriver).mockReturnValue({
      createDeployment: vi.fn().mockResolvedValue({
        externalServiceId: "svc1", externalDeployId: "dep1", publicUrl: "https://svc1.onrender.com", status: "provisioning", gatewayToken: "gw",
      }),
    } as never);
    vi.mocked(createCloudDeployment).mockResolvedValue({
      id: "d1", connectionId: "conn1", provider: "render", toolId: "openclaw", status: "provisioning",
      publicUrl: "https://svc1.onrender.com", createdAt: "now", updatedAt: "now",
      image: "img", region: "", instanceType: "free", port: 10000,
      externalServiceId: "svc1", externalDeployId: "dep1", gatewayToken: "gw", config: {}, error: null,
    } as never);

    const res = await POST(req({ provider: "render", toolId: "openclaw", model: "gpt-4o", modelProvider: "openai", gatewayApiKey: "sk-x" }) as never);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.deployment.id).toBe("d1");
    expect(json.deployment.gatewayToken).toBeUndefined();
  });

  it("rejects a duplicate deploy for the same tool+provider", async () => {
    vi.mocked(getCloudTool).mockReturnValue({ id: "openclaw", image: "img", port: 10000 } as never);
    vi.mocked(getCloudProviderDriver).mockReturnValue({ createDeployment: vi.fn() } as never);
    vi.mocked(getCloudConnectionByProvider).mockResolvedValue({ id: "conn1", token: "tok" } as never);
    vi.mocked(getCloudDeployments).mockResolvedValue([{ id: "d1", status: "healthy" } as never]);

    const res = await POST(req({ provider: "render", toolId: "openclaw", model: "gpt-4o", modelProvider: "openai", gatewayApiKey: "sk-x" }) as never);
    expect(res.status).toBe(409);
  });
});
