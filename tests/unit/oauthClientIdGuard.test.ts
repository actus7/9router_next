import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Several providers read their OAuth client id from the environment and fall
 * back to `""`. That empty value used to reach the query string, so the
 * operator was sent to Google and got a bare `400 invalid_request` back with
 * nothing naming the cause. Fail here, where the cause is known.
 */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function generate(provider: string) {
  vi.resetModules();
  const { generateAuthData } = await import("@/lib/oauth/providers/index");
  return generateAuthData(provider, "http://localhost:8080/callback");
}

describe("generateAuthData", () => {
  it("refuses to build a Google authorize URL with no client id", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "");

    await expect(generate("gemini-cli")).rejects.toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });

  it("builds the URL once the client id is configured", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "test-secret");

    const data = await generate("gemini-cli");
    expect(data.authUrl).toBeTruthy();
    const params = new URL(data.authUrl!).searchParams;
    expect(params.get("client_id")).toBe("test-client-id.apps.googleusercontent.com");
  });
});
