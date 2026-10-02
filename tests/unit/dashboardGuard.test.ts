import { afterEach, describe, expect, it } from "vitest";
import { __test__ } from "@/dashboardGuard";
import { NEON_AUTH_COOKIE_PREFIX } from "@neondatabase/auth/server";
import nextConfig from "../../next.config";

const originalPeerToken = process.env.NINEROUTER_PEER_TOKEN;
const originalLoopbackFlag = process.env.NINEROUTER_LOOPBACK_BOUND_PORT;
const originalNodeEnv = process.env.NODE_ENV;

// Index-signature write: `process.env.NODE_ENV` is narrowed by Next's types,
// and restoring a `string | undefined` back into it would not typecheck.
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restoreEnv("NINEROUTER_PEER_TOKEN", originalPeerToken);
  restoreEnv("NINEROUTER_LOOPBACK_BOUND_PORT", originalLoopbackFlag);
  restoreEnv("NODE_ENV", originalNodeEnv);
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

// Clientes Ollama falam com a raiz do host (`/api/chat`, `/api/tags`) e só
// mandam API key; a rota autentica pela key via gatewayRoute. Sem estar aqui,
// o middleware respondia 401 antes da rota por falta de cookie.
describe("Ollama root paths", () => {
  it("reach the API-key-gated routes without a dashboard session", () => {
    for (const path of ["/api/tags", "/api/chat"]) {
      expect(__test__.isPublicLlmApi(path), path).toBe(true);
    }
  });

  it("do not open neighbouring dashboard APIs", () => {
    for (const path of ["/api/settings", "/api/tagsx", "/api/chatbot"]) {
      expect(__test__.isPublicLlmApi(path), path).toBe(false);
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

/**
 * Single-host deploy: the compose `ports:` line binds 127.0.0.1 and
 * `NINEROUTER_LOOPBACK_BOUND_PORT` attests that fact. While it holds, a
 * loopback Host header is real evidence (off-host clients cannot even open the
 * socket), so production accepts it like development does. The flag and the
 * bind are one invariant — this suite pins both directions.
 */
describe("loopback-bound deploy flag", () => {
  function req(headers: Record<string, string>, cookies: string[] = []) {
    return {
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      cookies: { getAll: () => cookies.map((name) => ({ name, value: "x" })) },
    } as never;
  }

  function withFlag(flag: "1" | "0" | undefined): void {
    // Production on purpose: development already accepts Host loopback, so it
    // could never tell the flag apart from the old behaviour.
    restoreEnv("NODE_ENV", "production");
    restoreEnv("NINEROUTER_LOOPBACK_BOUND_PORT", flag);
  }

  it("flag ON + production + Host localhost is local and passes a local-only route", async () => {
    withFlag("1");
    const request = req(
      { host: "localhost" },
      [`${NEON_AUTH_COOKIE_PREFIX}.session_token`],
    );
    expect(__test__.isLocalRequest(request)).toBe(true);
    expect(await __test__.canAccessLocalOnlyRoute(request)).toBe(true);
  });

  it("flag ON does not bless a public or tunnel hostname", () => {
    withFlag("1");
    expect(__test__.isLocalRequest(req({ host: "ninerouter.example.trycloudflare.com" }))).toBe(false);
    expect(__test__.isLocalRequest(req({ host: "192.168.1.10:20128" }))).toBe(false);
  });

  it("flag ON does not override the via-proxy marker", () => {
    withFlag("1");
    expect(__test__.isLocalRequest(req({ host: "localhost", "x-9r-via-proxy": "1" }))).toBe(false);
  });

  it("flag ON does not override a non-loopback Origin", () => {
    withFlag("1");
    expect(__test__.isLocalRequest(req({ host: "localhost", origin: "https://evil.example.com" }))).toBe(false);
    // A loopback Origin is consistent with the loopback Host and stays local.
    expect(__test__.isLocalRequest(req({ host: "localhost", origin: "http://localhost:20128" }))).toBe(true);
  });

  it("flag OFF + production + Host localhost is NOT local", () => {
    // Regression pin for the pre-flag behaviour: "0" and unset both stay closed.
    withFlag("0");
    expect(__test__.isLocalRequest(req({ host: "localhost" }))).toBe(false);
    withFlag(undefined);
    expect(__test__.isLocalRequest(req({ host: "localhost" }))).toBe(false);
  });

  it("trusted-peer headers keep precedence over the flag", () => {
    restoreEnv("NINEROUTER_PEER_TOKEN", "peer-secret");
    // Trusted verdict wins even when the flag is off: real-ip loopback is local
    // on the strength of the stamped header alone.
    withFlag("0");
    expect(
      __test__.isLocalRequest(
        req({ host: "tunnel.example.com", "x-9r-peer-token": "peer-secret", "x-9r-real-ip": "127.0.0.1" }),
      ),
    ).toBe(true);
    // ...and wins the other way too: a stamped public real-ip is NOT local even
    // with the flag on and a loopback Host.
    withFlag("1");
    expect(
      __test__.isLocalRequest(
        req({ host: "localhost", "x-9r-peer-token": "peer-secret", "x-9r-real-ip": "203.0.113.9" }),
      ),
    ).toBe(false);
  });
});
