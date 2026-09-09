import { describe, expect, it, vi } from "vitest";
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
  /**
   * The four self-hostable provider families used to get `trusted-local`
   * unconditionally, which let any account use the validate endpoint as a blind
   * SSRF probe against the deployment's own network. They keep it, but only
   * where the operator said private endpoints are fine.
   */
  it("refuses private endpoints unless the deployment opted in", () => {
    vi.stubEnv("ALLOW_PRIVATE_PROVIDER_ENDPOINTS", "");
    expect(resolveProviderValidateFetchPolicy("http://127.0.0.1:11434", { providerId: "ollama" }))
      .toBe("public-only");
    expect(resolveProviderValidateFetchPolicy("http://localhost:8080", { providerId: "openai-compatible-foo" }))
      .toBe("public-only");
    vi.unstubAllEnvs();
  });

  it("allows trusted-local for ollama and compatible providers when opted in", () => {
    vi.stubEnv("ALLOW_PRIVATE_PROVIDER_ENDPOINTS", "true");
    expect(resolveProviderValidateFetchPolicy("http://127.0.0.1:11434", { providerId: "ollama" }))
      .toBe("trusted-local");
    expect(resolveProviderValidateFetchPolicy("http://localhost:8080", { providerId: "openai-compatible-foo" }))
      .toBe("trusted-local");
    vi.unstubAllEnvs();
  });

  it("still honours an explicit allowLocal caller", () => {
    vi.stubEnv("ALLOW_PRIVATE_PROVIDER_ENDPOINTS", "");
    expect(resolveProviderValidateFetchPolicy("http://127.0.0.1:11434", { allowLocal: true }))
      .toBe("trusted-local");
    vi.unstubAllEnvs();
  });

  it("uses public-only for remote hosts by default", () => {
    expect(resolveProviderValidateFetchPolicy("https://api.openai.com/v1/models", { providerId: "openai" }))
      .toBe("public-only");
  });
});
