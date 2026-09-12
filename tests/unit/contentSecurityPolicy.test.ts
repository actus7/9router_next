import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildContentSecurityPolicy,
  CSP_REPORT_PATH,
  REPORTING_ENDPOINTS,
} from "@/lib/security/contentSecurityPolicy";

/**
 * The policy is a list of claims about what the page loads. Each one below is
 * a claim that was checked against the running app, not a copy of a template:
 * Puter's SDK is a script we do not host, the topology graph writes its own
 * inline styles, and generated media arrives as bytes rather than as a URL.
 */

afterEach(() => {
  // Every env this file touches is stubbed, so unstubbing is the whole reset.
  // Assigning `process.env.NODE_ENV` back by hand does not typecheck anyway --
  // it is declared read-only.
  vi.unstubAllEnvs();
});

function directive(policy: string, name: string): string {
  const found = policy.split("; ").find((part) => part.startsWith(`${name} `) || part === name);
  return found ?? "";
}

describe("the content security policy", () => {
  it("nonces the script directive and still admits the Puter SDK", () => {
    const policy = buildContentSecurityPolicy("abc123");
    const scriptSrc = directive(policy, "script-src");
    expect(scriptSrc).toContain("'nonce-abc123'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    // Puter runs the completion inside its own page; the SDK cannot be bundled.
    expect(scriptSrc).toContain("https://js.puter.com");
  });

  it("never admits inline script, whatever else it allows", () => {
    const policy = buildContentSecurityPolicy("abc123");
    expect(directive(policy, "script-src")).not.toContain("'unsafe-inline'");
    // Styles are the deliberate exception — @xyflow/react positions nodes with
    // inline style it writes itself, and inline CSS is the weaker vector.
    expect(directive(policy, "style-src")).toContain("'unsafe-inline'");
  });

  it("allows the browser to reach the account's own Neon Auth instance", () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.example.test/some/path");
    const connectSrc = directive(buildContentSecurityPolicy("n"), "connect-src");
    // The origin, not the configured URL: a path in `connect-src` is ignored.
    expect(connectSrc).toContain("https://auth.example.test");
    expect(connectSrc).not.toContain("/some/path");
  });

  it("stays well-formed when the auth base URL is missing or unparseable", () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", "not a url");
    const policy = buildContentSecurityPolicy("n");
    // The failure mode this guards: emitting the literal "undefined" as an
    // allowed origin, which is a valid-looking host name.
    expect(policy).not.toContain("undefined");
    expect(directive(policy, "connect-src")).toContain("'self'");
  });

  it("points violations at the collector, by both mechanisms", () => {
    const policy = buildContentSecurityPolicy("n");
    expect(policy).toContain(`report-uri ${CSP_REPORT_PATH}`);
    expect(policy).toContain("report-to csp");
    expect(REPORTING_ENDPOINTS).toBe(`csp="${CSP_REPORT_PATH}"`);
  });

  it("closes the directives an injected page would otherwise reach for", () => {
    const policy = buildContentSecurityPolicy("n");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
  });
});
