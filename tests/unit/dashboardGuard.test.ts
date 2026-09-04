import { afterEach, describe, expect, it } from "vitest";
import { __test__ } from "@/dashboardGuard";
import nextConfig from "../../next.config";

const originalPeerToken = process.env.NINEROUTER_PEER_TOKEN;

function requestFrom(peerIp: string, token = "test-peer-token"): Request {
  process.env.NINEROUTER_PEER_TOKEN = token;
  return new Request("http://router.example.test/api/smart-routing/profiles", {
    headers: {
      "x-9r-peer-token": token,
      "x-9r-real-ip": peerIp,
    },
  });
}

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

describe("unauthenticated dashboard mode", () => {
  it("permits disabling login only for a trusted loopback peer", () => {
    expect(__test__.canUseUnauthenticatedLocalMode(requestFrom("127.0.0.1") as never)).toBe(true);
  });

  it("does not expose administrative APIs to a remote peer", () => {
    expect(__test__.canUseUnauthenticatedLocalMode(requestFrom("203.0.113.10") as never)).toBe(false);
  });

  it("does not trust an attacker supplied real-ip header", () => {
    process.env.NINEROUTER_PEER_TOKEN = "expected-token";
    const request = new Request("http://router.example.test/api/smart-routing/profiles", {
      headers: { "x-9r-real-ip": "127.0.0.1", "x-9r-peer-token": "wrong-token" },
    });
    expect(__test__.canUseUnauthenticatedLocalMode(request as never)).toBe(false);
  });
});
