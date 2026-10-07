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
  it("falls back to the built-in client when the env is empty, so the URL never carries an empty client_id", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "");

    const data = await generate("gemini-cli");
    expect(new URL(data.authUrl!).searchParams.get("client_id")).toBeTruthy();
  });

  it("uses the env client when one is configured", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "test-secret");

    const data = await generate("gemini-cli");
    expect(data.authUrl).toBeTruthy();
    const params = new URL(data.authUrl!).searchParams;
    expect(params.get("client_id")).toBe("test-client-id.apps.googleusercontent.com");
  });
});
