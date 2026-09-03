import { describe, expect, it } from "vitest";
import {
  resolveConnectionAuthType,
  resolveProviderAuthContext,
} from "@/shared/constants/providers";
import {
  resolveProviderValidateFetchPolicy,
} from "@/server/application/use-cases/http/providers/validate/providerValidateFetch";

describe("provider auth selectors", () => {
  it("defaults oauth providers to oauth connection auth", () => {
    const ctx = resolveProviderAuthContext("claude", undefined);
    expect(ctx.isOAuth).toBe(true);
    expect(resolveConnectionAuthType("claude", undefined)).toBe("oauth");
  });

  it("respects explicit connection auth type", () => {
    expect(resolveConnectionAuthType("openai", "apikey")).toBe("apikey");
    expect(resolveConnectionAuthType("openai", "api_key")).toBe("apikey");
  });
});

describe("providerValidateFetch policy", () => {
  it("allows trusted-local for ollama and compatible providers", () => {
    expect(resolveProviderValidateFetchPolicy("http://127.0.0.1:11434", { providerId: "ollama" }))
      .toBe("trusted-local");
    expect(resolveProviderValidateFetchPolicy("http://localhost:8080", { providerId: "openai-compatible-foo" }))
      .toBe("trusted-local");
  });

  it("uses public-only for remote hosts by default", () => {
    expect(resolveProviderValidateFetchPolicy("https://api.openai.com/v1/models", { providerId: "openai" }))
      .toBe("public-only");
  });
});
