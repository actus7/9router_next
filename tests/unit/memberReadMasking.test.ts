import { describe, expect, it, vi } from "vitest";

/**
 * The reads a member's chat still needs hand back the fields the screen reads,
 * never the record an admin edits: web providers keep session cookies in
 * `providerSpecificData`, and an outbound proxy URL carries its password. And a
 * route that skips the chat handlers still runs their model policy.
 */

const getProviderCredentials = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repos/connectionsRepo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getProviderConnections: async () => [{
    id: "c1", provider: "chatgpt-web", name: "Web", isActive: true, apiKey: "sk-secret",
    providerSpecificData: { prefix: "cgw", cookie: "session=abc", enabledModels: ["gpt-5"] },
  }],
  getProviderNodes: async () => [],
}));
vi.mock("@/lib/db/repos/settingsRepo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSettings: async () => ({ requireApiKey: false, outboundProxyUrl: "http://u:pw@proxy", outboundProxyEnabled: true, rtkEnabled: true, someFutureCredential: "s3cr3t" }),
}));
vi.mock("@/server/application/http/requestRuntime", () => ({ assertRequestRuntime: async () => {} }));
vi.mock("@/server/llm-gateway/auth/accountSelection", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getProviderCredentials,
}));

import { withTenant } from "@/lib/db/tenant";
import { withAccessLayers } from "@/server/llm-gateway/application/accessScope";
import { GET as providersGET } from "@/server/application/use-cases/http/providers/route";
import { GET as settingsGET, MEMBER_READABLE_SETTINGS } from "@/server/application/use-cases/http/settings/route";
import { profileFromSettings } from "@/shared/gateway/gatewayProfile";
import { forwardGeminiNativeRequest } from "@/server/application/use-cases/http/v1beta/models/geminiNativeForward";

const asRole = <T>(role: "member" | "admin", fn: () => Promise<T>) =>
  withTenant({ tenantId: "org-1", actorUserId: "u-1", role }, fn);

describe("reads a member's chat makes", () => {
  it("lists providers without their secrets or session cookies", async () => {
    const body = await (await asRole("member", () => providersGET())).json();
    expect(body.connections[0]).toEqual({
      id: "c1", provider: "chatgpt-web", name: "Web", isActive: true,
      providerSpecificData: { prefix: "cgw", enabledModels: ["gpt-5"] },
    });
  });

  it("still gives an admin the full record", async () => {
    const body = await (await asRole("admin", () => providersGET())).json();
    expect(body.connections[0].providerSpecificData.cookie).toBe("session=abc");
  });

  it("drops proxy URLs from the settings a member reads", async () => {
    const body = await (await asRole("member", () => settingsGET())).json();
    expect(body.outboundProxyUrl).toBeUndefined();
    expect(body.outboundProxyEnabled).toBeUndefined();
    expect(body.rtkEnabled).toBe(true);
  });

  it("gives a member only the settings their screens read, so a new key is closed by default", async () => {
    const body = await (await asRole("member", () => settingsGET())).json();
    expect(body.someFutureCredential).toBeUndefined();
    expect(body.requireApiKey).toBeUndefined();
    expect(typeof body.enableTranslator).toBe("boolean");
  });

  it("lets through every setting a chat's default abilities are read from", () => {
    const read = new Set<string>();
    profileFromSettings(new Proxy({}, { get: (_target, key) => { read.add(String(key)); return undefined; } }));
    expect([...read].filter((key) => !MEMBER_READABLE_SETTINGS.has(key))).toEqual([]);
  });
});

describe("Gemini native forwarding", () => {
  it("refuses a model the key's policy leaves out before touching an account", async () => {
    const response = await asRole("member", () =>
      withAccessLayers([{ models: ["cx/*"] }], () =>
        forwardGeminiNativeRequest(new Request("http://x"), {}, "gemini-3-pro", "generateContent")));
    expect(response.status).toBe(403);
    expect(getProviderCredentials).not.toHaveBeenCalled();
  });
});
