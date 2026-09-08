import { afterEach, describe, expect, it } from "vitest";
import { __test__ } from "@/dashboardGuard";
import { NEON_AUTH_COOKIE_PREFIX } from "@neondatabase/auth/server";
import nextConfig from "../../next.config";

const originalPeerToken = process.env.NINEROUTER_PEER_TOKEN;


afterEach(() => {
  if (originalPeerToken === undefined) delete process.env.NINEROUTER_PEER_TOKEN;
  else process.env.NINEROUTER_PEER_TOKEN = originalPeerToken;
});

describe("gateway edge allowlist", () => {
  it("treats every rewrite into the gateway as a public LLM path", async () => {
    const rewrites = await nextConfig.rewrites?.();
    const rules = Array.isArray(rewrites) ? rewrites : (rewrites?.afterFiles ?? []);
    const gatewayRules = rules.filter((rule) => rule.destination.startsWith("/api/v1"));

    expect(gatewayRules.length).toBeGreaterThan(0);
    // The proxy sees the pre-rewrite path, so a rewrite source missing from
    // PUBLIC_PREFIXES reaches the gateway without the API-key check.
    for (const rule of gatewayRules) {
      const incomingPath = rule.source.replace(/\/:[^/]+$/, "");
      expect(__test__.isPublicLlmApi(incomingPath), `rewrite source ${rule.source}`).toBe(true);
    }
  });
});

/**
 * Files under `public/` must not be answered with a redirect to sign-in.
 *
 * The proxy matcher lets everything but `_next/*` through, and the tail of the
 * proxy is now the Neon Auth middleware. A translation file that came back as
 * the sign-in HTML is how this was found: the page rendered, the labels stayed
 * English, and nothing failed loudly.
 */
describe("public assets", () => {
  it("recognises files served from public/", () => {
    for (const path of [
      "/i18n/literals/pt-BR.json",
      "/providers/openai.svg",
      "/icons/apple-icon.png",
      "/CHANGELOG.md",
    ]) {
      expect(__test__.isPublicAsset(path), path).toBe(true);
    }
  });

  it("does not mistake a page or an API path for one", () => {
    for (const path of ["/dashboard", "/dashboard/providers", "/auth/sign-in", "/api/settings", "/"]) {
      expect(__test__.isPublicAsset(path), path).toBe(false);
    }
  });
});

/**
 * The session-cookie pre-check must agree with the name Neon Auth actually
 * sets. Spelled by hand it read `neon-auth.`, which matches nothing: the
 * dashboard pages loaded (Neon's own middleware guards those) while every
 * fetch the dashboard made came back 401.
 */
describe("session cookie detection", () => {
  function withCookies(names: string[]) {
    return {
      cookies: { getAll: () => names.map((name) => ({ name, value: "x" })) },
    } as never;
  }

  it("recognises the cookie Neon Auth sets", () => {
    expect(__test__.hasSessionCookie(withCookies([`${NEON_AUTH_COOKIE_PREFIX}.session_token`]))).toBe(true);
  });

  it("is anchored on the SDK constant, not a hand-written prefix", () => {
    // If the SDK ever renames it, this fails here instead of as a 401 on every
    // dashboard fetch.
    expect(NEON_AUTH_COOKIE_PREFIX).toBe("__Secure-neon-auth");
  });

  it("ignores unrelated cookies", () => {
    expect(__test__.hasSessionCookie(withCookies(["locale", "theme", "neon-auth."]))).toBe(false);
  });
});
