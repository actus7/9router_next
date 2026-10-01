import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_MODELS_CONFIG } from "@/server/application/use-cases/http/providers/[id]/models/providerModelsConfig";

type Resolver = (connection: Record<string, unknown>) => Promise<{
  models?: Record<string, unknown>[];
  error?: string;
  status?: number;
  warning?: string;
}>;

const resolver = () => PROVIDER_MODELS_CONFIG["antigravity"]?.customResolver as Resolver | undefined;

// fetchAvailableModels answers with `models` as a map keyed by model id — the
// shape the static `v1internal:models` entry used to parse as if it were an
// array. That endpoint never existed on the sandbox host, so the listing came
// back as a bare Google 404 HTML page.
const availableModelsResponse = {
  models: {
    "gemini-3.5-flash": { displayName: "Gemini 3.5 Flash", isDefault: true },
    "claude-sonnet-4-6": { displayName: "Claude Sonnet 4.6" },
    "some-internal-model": { isInternal: true },
  },
};

afterEach(() => vi.restoreAllMocks());

describe("antigravity models listing", () => {
  it("fetches the live catalogue from fetchAvailableModels with the IDE fingerprint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(availableModelsResponse), { status: 200 }),
    );

    const result = await resolver()!({
      accessToken: "ya29.token",
      providerSpecificData: { projectId: "project-123" },
    });

    expect(result.models?.map((m) => m.id)).toEqual(["gemini-3.5-flash", "claude-sonnet-4-6"]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ project: "project-123" });

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ya29.token");
    expect(headers["User-Agent"]).toMatch(/^antigravity\/ide\//);
    expect(headers["X-Client-Name"]).toBe("antigravity");
    expect(headers["X-Client-Version"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("sends no project when the connection never resolved one", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(availableModelsResponse), { status: 200 }),
    );

    await resolver()!({ accessToken: "ya29.token", providerSpecificData: {} });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("does not hit the sandbox :models endpoint that caused the 404", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(availableModelsResponse), { status: 200 }),
    );

    await resolver()!({ accessToken: "ya29.token", providerSpecificData: {} });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toMatch(/sandbox/);
    expect(url).not.toMatch(/v1internal:models$/);
  });
});
