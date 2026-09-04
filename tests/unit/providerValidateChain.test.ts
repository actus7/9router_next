import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/application/use-cases/http/providers/validate/validateSpecialHandlers", () => ({
  handleOpenAiCompatibleNode: vi.fn(),
  handleCustomEmbeddingNode: vi.fn(),
  handleAnthropicCompatibleNode: vi.fn(),
  handleCloudflareAi: vi.fn(),
  handleAzure: vi.fn(),
}));
vi.mock("@/server/application/use-cases/http/providers/validate/validateProbes", () => ({
  probeWebProvider: vi.fn(async () => null),
  probeMediaProvider: vi.fn(async () => null),
}));
vi.mock("@/server/application/use-cases/http/providers/validate/validateProviderKey", () => ({
  validateProviderKey: vi.fn(),
}));

import { POST } from "@/server/application/use-cases/http/providers/validate/route";
import {
  handleAnthropicCompatibleNode,
  handleOpenAiCompatibleNode,
} from "@/server/application/use-cases/http/providers/validate/validateSpecialHandlers";
import {
  probeMediaProvider,
  probeWebProvider,
} from "@/server/application/use-cases/http/providers/validate/validateProbes";
import { validateProviderKey } from "@/server/application/use-cases/http/providers/validate/validateProviderKey";
import { probeFailed, probeOk } from "@/server/llm-gateway/probe/types";

const nodeProbe = vi.mocked(handleOpenAiCompatibleNode);
const anthropicNodeProbe = vi.mocked(handleAnthropicCompatibleNode);
const webProbe = vi.mocked(probeWebProvider);
const mediaProbe = vi.mocked(probeMediaProvider);
const tableProbe = vi.mocked(validateProviderKey);

function post(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/providers/validate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  webProbe.mockResolvedValue(null);
  mediaProbe.mockResolvedValue(null);
  tableProbe.mockResolvedValue(probeOk());
});

describe("validate probe chain precedence", () => {
  it("lets a node-backed provider answer before any other stage", async () => {
    nodeProbe.mockResolvedValue(probeOk());

    const res = await POST(post({ providerId: "openai-compatible-abc", apiKey: "k" }) as never);

    expect(await res.json()).toEqual({ valid: true, error: null });
    expect(nodeProbe).toHaveBeenCalledOnce();
    expect(webProbe).not.toHaveBeenCalled();
    expect(tableProbe).not.toHaveBeenCalled();
  });

  it("prefers the web probe over the per-provider table", async () => {
    webProbe.mockResolvedValue(probeOk());

    const res = await POST(post({ providerId: "brave-search", apiKey: "k" }) as never);

    expect((await res.json()).valid).toBe(true);
    expect(mediaProbe).not.toHaveBeenCalled();
    expect(tableProbe).not.toHaveBeenCalled();
  });

  it("prefers the media probe over the per-provider table", async () => {
    mediaProbe.mockResolvedValue(probeFailed("Invalid API key", { status: 401 }));

    const res = await POST(post({ providerId: "deepgram", apiKey: "k" }) as never);

    expect(await res.json()).toEqual({ valid: false, error: "Invalid API key" });
    expect(tableProbe).not.toHaveBeenCalled();
  });

  it("falls through to the per-provider table when both probes decline", async () => {
    tableProbe.mockResolvedValue(probeFailed("Invalid API key"));

    const res = await POST(post({ providerId: "openai", apiKey: "k" }) as never);

    expect((await res.json()).valid).toBe(false);
    expect(tableProbe).toHaveBeenCalledOnce();
  });
});

describe("validate response mapping", () => {
  it("answers 404 for a node that does not exist", async () => {
    anthropicNodeProbe.mockResolvedValue(
      probeFailed("Anthropic Compatible node not found", { configError: "missing-node" }),
    );

    const res = await POST(post({ providerId: "anthropic-compatible-xyz", apiKey: "k" }) as never);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Anthropic Compatible node not found" });
  });

  it("answers 400 when required configuration is missing", async () => {
    tableProbe.mockResolvedValue(
      probeFailed("Provider validation not supported", { configError: "missing-config" }),
    );

    const res = await POST(post({ providerId: "openai", apiKey: "k" }) as never);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ valid: false, error: "Provider validation not supported" });
  });

  it("keeps a rejected credential at 200 so the form can show the reason", async () => {
    tableProbe.mockResolvedValue(probeFailed("Invalid API key", { status: 401 }));

    const res = await POST(post({ providerId: "openai", apiKey: "bad" }) as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false, error: "Invalid API key" });
  });

  it("passes a warning through for a credential that works with a caveat", async () => {
    tableProbe.mockResolvedValue(probeOk({ warning: "Balance exhausted" }));

    const res = await POST(post({ providerId: "openai", apiKey: "k" }) as never);

    expect(await res.json()).toEqual({ valid: true, error: null, warning: "Balance exhausted" });
  });

  it("requires a provider and a key unless the provider needs no auth", async () => {
    const res = await POST(post({ providerId: "openai" }) as never);

    expect(res.status).toBe(400);
    expect(tableProbe).not.toHaveBeenCalled();
  });

  it("reports an inconclusive probe instead of failing the endpoint", async () => {
    tableProbe.mockRejectedValue(new Error("socket hang up"));

    const res = await POST(post({ providerId: "openai", apiKey: "k" }) as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false, error: "socket hang up" });
  });
});
