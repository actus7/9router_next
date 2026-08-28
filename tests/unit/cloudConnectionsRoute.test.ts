import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/models", () => ({
  createCloudConnection: vi.fn(),
  deleteCloudConnection: vi.fn(),
  getCloudConnectionByProvider: vi.fn(),
  getCloudDeployments: vi.fn(),
}));
vi.mock("@/server/cloud/providers/registry", () => ({
  getCloudProviderDriver: vi.fn(),
}));

import { POST, DELETE } from "@/app/api/cloud/connections/[provider]/route";
import { createCloudConnection, deleteCloudConnection, getCloudConnectionByProvider, getCloudDeployments } from "@/models";
import { getCloudProviderDriver } from "@/server/cloud/providers/registry";

function req(body: unknown): Request {
  return new Request("http://localhost/api/cloud/connections/render", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/cloud/connections/[provider]", () => {
  it("rejects an unsupported provider", async () => {
    vi.mocked(getCloudProviderDriver).mockReturnValue(null);
    const res = await POST(req({ token: "x" }) as never, { params: Promise.resolve({ provider: "unknown" }) });
    expect(res.status).toBe(400);
  });

  it("rejects a missing token", async () => {
    vi.mocked(getCloudProviderDriver).mockReturnValue({ validateToken: vi.fn() } as never);
    const res = await POST(req({}) as never, { params: Promise.resolve({ provider: "render" }) });
    expect(res.status).toBe(400);
  });

  it("creates a connection when the token validates", async () => {
    vi.mocked(getCloudProviderDriver).mockReturnValue({
      validateToken: vi.fn().mockResolvedValue({ externalUserEmail: "a@b.com", externalUserId: "1", externalOrgId: "1", externalOrgName: "Org" }),
    } as never);
    vi.mocked(createCloudConnection).mockResolvedValue({
      id: "conn1", provider: "render", label: null, token: "x",
      externalUserEmail: "a@b.com", externalOrgId: "1", externalOrgName: "Org",
      createdAt: "now", updatedAt: "now",
    } as never);

    const res = await POST(req({ token: "sometoken" }) as never, { params: Promise.resolve({ provider: "render" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.connection.id).toBe("conn1");
  });
});

describe("DELETE /api/cloud/connections/[provider]", () => {
  it("returns 404 when there is no connection for the provider", async () => {
    vi.mocked(getCloudConnectionByProvider).mockResolvedValue(null);
    const res = await DELETE(new Request("http://localhost") as never, { params: Promise.resolve({ provider: "render" }) });
    expect(res.status).toBe(404);
  });

  it("deletes an existing connection", async () => {
    vi.mocked(getCloudConnectionByProvider).mockResolvedValue({ id: "conn1" } as never);
    vi.mocked(getCloudDeployments).mockResolvedValue([]);
    const res = await DELETE(new Request("http://localhost") as never, { params: Promise.resolve({ provider: "render" }) });
    expect(res.status).toBe(200);
    expect(deleteCloudConnection).toHaveBeenCalledWith("conn1");
  });

  it("rejects when deployments still reference the connection", async () => {
    vi.mocked(getCloudConnectionByProvider).mockResolvedValue({ id: "conn1" } as never);
    vi.mocked(getCloudDeployments).mockResolvedValue([{ id: "d1", connectionId: "conn1", provider: "render" } as never]);
    const res = await DELETE(new Request("http://localhost") as never, { params: Promise.resolve({ provider: "render" }) });
    expect(res.status).toBe(409);
    expect(deleteCloudConnection).not.toHaveBeenCalled();
  });
});
