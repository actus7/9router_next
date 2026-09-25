import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `gatewayRoute` already resolves the key's owner and 401s an unknown key, so
 * the application gate re-querying `apiKeys` for the same key was a second
 * round trip per request. It may only be skipped for *that* key in *that*
 * scope: the durable-run worker calls the chat application in-process with no
 * `gatewayRoute` around it, and there the gate is the only key check.
 */
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(async () => ({ requireApiKey: true })),
}));
vi.mock("@/lib/db/repos/apiKeysRepo", () => ({
  resolveApiKeyOwner: vi.fn(async (key: string) => (key === "sk-good" ? { userId: "u1", id: "k1" } : null)),
  validateApiKey: vi.fn(async (key: string) => key === "sk-good"),
}));

import { gatewayRoute } from "@/server/application/http/gatewayRoute";
import { requireGatewayApiKey } from "@/server/llm-gateway/application/gatewayApiKey";
import { resolveApiKeyOwner, validateApiKey } from "@/lib/db/repos/apiKeysRepo";

function keyLookups(): number {
  return vi.mocked(resolveApiKeyOwner).mock.calls.length + vi.mocked(validateApiKey).mock.calls.length;
}

function request(key: string): Request {
  return new Request("https://gw.test/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}` } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("gateway API key is looked up once per request", () => {
  it("through gatewayRoute, the application gate does not re-query apiKeys", async () => {
    const route = gatewayRoute(async (req: Request) => {
      const denied = await requireGatewayApiKey(req.headers.get("authorization")!.slice(7));
      return denied ?? new Response("ok");
    });
    const response = await route(request("sk-good"));
    expect(response.status).toBe(200);
    expect(keyLookups()).toBe(1);
  });

  it("inside gatewayRoute, a different key than the verified one is still checked", async () => {
    const route = gatewayRoute(async () => (await requireGatewayApiKey("sk-bad")) ?? new Response("ok"));
    const response = await route(request("sk-good"));
    expect(response.status).toBe(401);
    expect(keyLookups()).toBe(2);
  });

  it("an in-process call with no gatewayRoute still validates and rejects an invalid key", async () => {
    const denied = await requireGatewayApiKey("sk-bad");
    expect(denied?.status).toBe(401);
    expect(keyLookups()).toBe(1);
    expect(await requireGatewayApiKey("sk-good")).toBeNull();
  });

  it("gatewayRoute's 401 carries the OpenAI error code", async () => {
    const route = gatewayRoute(async () => new Response("ok"));
    const body = await (await route(request("sk-bad"))).json();
    expect(body.error).toMatchObject({ type: "invalid_request_error", code: "invalid_api_key" });
  });
});
