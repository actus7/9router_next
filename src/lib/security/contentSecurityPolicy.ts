/**
 * The page's Content Security Policy.
 *
 * The app already sends `X-Frame-Options`, `nosniff`, `Referrer-Policy` and
 * `Permissions-Policy` (`next.config.ts`). CSP was the one missing, and it is
 * the one that matters most here: `SafeMarkdown` renders model output, which is
 * attacker-influenced text by definition — the project already treats it that
 * way, with an 80% coverage floor on that file alone. CSP is the layer that
 * still holds if that parser ever slips.
 *
 * Shipped report-only first. Every directive below is a claim about what the
 * page actually loads, and one of them — everything `js.puter.com` reaches once
 * its SDK boots — cannot be read off the source. Enforcing a wrong guess breaks
 * chat for everyone; reporting a wrong guess costs a console line.
 */

/** Where the nonce and policy ride into the renderer. Lowercase: request headers. */
export const CSP_REPORT_ONLY_HEADER = "content-security-policy-report-only";

/** The Neon Auth instance the browser talks to, as a bare origin. */
function authOrigin(): string {
  const base = process.env.NEON_AUTH_BASE_URL || "";
  try {
    return new URL(base).origin;
  } catch {
    // No base URL configured is a boot-time failure elsewhere (`requireEnv` in
    // lib/auth/server). Returning nothing here keeps the policy well-formed
    // instead of emitting a literal "undefined" as an allowed origin.
    return "";
  }
}

/**
 * Puter runs the completion inside its own page, so its SDK is a script we do
 * not host and cannot bundle — see `puterBrowser.ts`. It is named explicitly
 * rather than covered by a wildcard.
 */
const PUTER_SCRIPT_ORIGIN = "https://js.puter.com";

export function buildContentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const auth = authOrigin();
  const directives = [
    "default-src 'self'",
    // `strict-dynamic` lets the nonced Next bootstrap load the chunks it needs
    // without listing each one. `unsafe-eval` is React's dev-only error
    // reconstruction; neither React nor Next use eval in production.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${PUTER_SCRIPT_ORIGIN}${isDev ? " 'unsafe-eval'" : ""}`,
    // Deliberately not nonced. A nonce in `style-src` makes the browser ignore
    // `'unsafe-inline'`, and @xyflow/react (the topology graph) positions nodes
    // with inline styles it writes itself. Inline CSS is a far weaker vector
    // than inline script, and this is the directive that buys the least.
    "style-src 'self' 'unsafe-inline'",
    // `blob:`/`data:` are generated media — images, audio and video the tools
    // produce come back as bytes, not as URLs on a host.
    "img-src 'self' blob: data: https://pub-1fb693cb11cc46b2b2f656f51e015a2c.r2.dev",
    "media-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self' ${[auth, PUTER_SCRIPT_ORIGIN].filter(Boolean).join(" ")}`,
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Same statement as the `X-Frame-Options: DENY` already sent, in the header
    // that modern browsers actually consult.
    "frame-ancestors 'none'",
    // `report-uri` is deprecated and still the one every browser honours;
    // `report-to` is the replacement and needs the `Reporting-Endpoints`
    // response header beside it. Both, so the reports actually arrive.
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** Where violations are posted. Public by design — see the route's own note. */
export const CSP_REPORT_PATH = "/api/csp-report";

/** The Reporting API group name, shared by `report-to` and the header below. */
const CSP_REPORT_GROUP = "csp";

/** The `Reporting-Endpoints` value that makes `report-to` resolvable. */
export const REPORTING_ENDPOINTS = `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;
