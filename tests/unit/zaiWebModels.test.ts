import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_MODELS_CONFIG } from "@/server/application/use-cases/http/providers/[id]/models/providerModelsConfig";

type Resolver = (connection: Record<string, unknown>) => Promise<{
  models?: Record<string, unknown>[];
  error?: string;
  status?: number;
  warning?: string;
}>;

const resolver = () => PROVIDER_MODELS_CONFIG["zai-web"]?.customResolver as Resolver | undefined;
const connection = (apiKey: unknown) => ({ apiKey, providerSpecificData: {} });

afterEach(() => vi.restoreAllMocks());

describe("zai-web models listing", () => {
  it("lists the live models of the captured session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "glm-5.3", name: "GLM-5.3" }, { id: "glm-5.2", name: "GLM-5.2" }] }), { status: 200 }),
    );

    const result = await resolver()!(connection(JSON.stringify({ token: "jwt-token", captcha_verify_param: "captcha" })));

    expect(result.models?.map((m) => m.id)).toEqual(["glm-5.3", "glm-5.2"]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://chat.z.ai/api/models");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-token");
  });

  it("asks for a fresh capture when the credential carries no token", async () => {
    const result = await resolver()!(connection("   "));
    expect(result.status).toBe(401);
    expect(result.error).toMatch(/chat\.z\.ai/);
  });

  it("falls back to the static catalog when the session returns nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    const result = await resolver()!(connection(JSON.stringify({ token: "jwt-token" })));

    expect(result.models?.map((m) => m.id)).toContain("glm-5.3");
    expect(result.warning).toBeTruthy();
  });

  it("surfaces an expired session as an auth error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));

    const result = await resolver()!(connection(JSON.stringify({ token: "expired" })));

    expect(result.status).toBe(401);
  });
});
