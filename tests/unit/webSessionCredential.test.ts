import { describe, it, expect } from "vitest";
import {
  parseWebSessionCredential,
  type ParsedWebSessionCredential,
  type CredentialOrigin,
} from "@/app/(dashboard)/dashboard/providers/[id]/utils/webSessionCredential";

// ── helpers ──────────────────────────────────────────────────────────────────

function expectOrigin(
  result: ParsedWebSessionCredential | null,
  origin: CredentialOrigin,
) {
  expect(result).not.toBeNull();
  expect(result!.origin).toBe(origin);
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("parseWebSessionCredential", () => {
  // ── empty / invalid ──────────────────────────────────────────────────────

  it("returns null for empty string", () => {
    expect(parseWebSessionCredential("")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(parseWebSessionCredential("   \n\t  ")).toBeNull();
  });

  it("returns null for non-string input (defensive)", () => {
    // @ts-expect-error — testing runtime guard
    expect(parseWebSessionCredential(undefined)).toBeNull();
    // @ts-expect-error — testing runtime guard
    expect(parseWebSessionCredential(null)).toBeNull();
  });

  // ── cURL: Cookie via -H ──────────────────────────────────────────────────

  it("extracts Cookie from curl -H with single quotes", () => {
    const input = `curl 'https://api.example.com/v1/chat' -H 'Cookie: session_id=abc123; theme=dark'`;
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "curl-cookie");
    expect(result!.credential).toBe("session_id=abc123; theme=dark");
  });

  it("extracts Cookie from curl --header with double quotes", () => {
    const input = `curl https://api.example.com --header "Cookie: token=xyz"`;
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "curl-cookie");
    expect(result!.credential).toBe("token=xyz");
  });

  it("extracts Cookie from curl -b shorthand", () => {
    const input = `curl -b 'sess=abc; lang=en' https://example.com`;
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "curl-cookie");
    expect(result!.credential).toBe("sess=abc; lang=en");
  });

  it("extracts Cookie from curl --cookie shorthand", () => {
    const input = `curl --cookie "id=12345" https://example.com`;
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "curl-cookie");
    expect(result!.credential).toBe("id=12345");
  });

  // ── cURL: Authorization Bearer ───────────────────────────────────────────

  it("extracts Bearer token from curl -H Authorization", () => {
    const input = `curl https://api.example.com -H 'Authorization: Bearer sk-abc123'`;
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "curl-authorization");
    expect(result!.credential).toBe("sk-abc123");
  });

  it("extracts Bearer token from curl --header Authorization with double quotes", () => {
    const input = `curl --header "Authorization: Bearer my.jwt.token" https://api.example.com`;
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "curl-authorization");
    expect(result!.credential).toBe("my.jwt.token");
  });

  // ── cURL: Cookie takes priority over Authorization ───────────────────────

  it("prefers Cookie over Authorization when both are present in cURL", () => {
    const input = `curl https://api.example.com -H 'Authorization: Bearer sk-secret' -H 'Cookie: session=abc'`;
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "curl-cookie");
    expect(result!.credential).toBe("session=abc");
  });

  it("prefers -b cookie over -H Authorization in cURL", () => {
    const input = `curl -b 'sid=111' -H 'Authorization: Bearer tok222' https://example.com`;
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "curl-cookie");
    expect(result!.credential).toBe("sid=111");
  });

  // ── cURL: multiline (Chrome "Copy as cURL") ─────────────────────────────

  it("handles multiline cURL with backslash continuations", () => {
    const input = `curl 'https://api.example.com/v1/chat' \\
  -H 'Cookie: session_id=multiline_test' \\
  -H 'Content-Type: application/json'`;
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "curl-cookie");
    expect(result!.credential).toBe("session_id=multiline_test");
  });

  it("handles multiline cURL with Windows caret continuations", () => {
    const input = `curl https://api.example.com ^
  -H "Authorization: Bearer caret-token" ^
  -H "Accept: application/json"`;
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "curl-authorization");
    expect(result!.credential).toBe("caret-token");
  });

  // ── standalone headers ───────────────────────────────────────────────────

  it("extracts Authorization Bearer from standalone header text", () => {
    const input = "Authorization: Bearer standalone-token-value";
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "header-authorization");
    expect(result!.credential).toBe("standalone-token-value");
  });

  it("extracts Cookie from standalone header text", () => {
    const input = "Cookie: my_cookie=value123; another=abc";
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "header-cookie");
    expect(result!.credential).toBe("my_cookie=value123; another=abc");
  });

  it("is case-insensitive for header names", () => {
    const input = "authorization: bearer lower-case-token";
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "header-authorization");
    expect(result!.credential).toBe("lower-case-token");
  });

  // ── JSON object ──────────────────────────────────────────────────────────

  it("returns minified JSON for a valid JSON object", () => {
    const input = `{
      "apiKey": "sk-test123",
      "baseUrl": "https://api.z.ai",
      "model": "gpt-4"
    }`;
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "json");
    expect(result!.credential).toBe(
      '{"apiKey":"sk-test123","baseUrl":"https://api.z.ai","model":"gpt-4"}',
    );
  });

  it("does not treat a JSON array as a JSON credential", () => {
    const input = '["a", "b", "c"]';
    const result = parseWebSessionCredential(input);
    // arrays fall through to raw
    expectOrigin(result, "raw");
  });

  it("does not treat a JSON primitive as a JSON credential", () => {
    const input = '"just a string"';
    const result = parseWebSessionCredential(input);
    // falls through to raw (quotes stripped)
    expect(result!.credential).toBe("just a string");
    expect(result!.origin).toBe("raw");
  });

  // ── raw fallback ─────────────────────────────────────────────────────────

  it("returns raw token when no pattern matches", () => {
    const input = "sk-proj-abcdef1234567890";
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "raw");
    expect(result!.credential).toBe("sk-proj-abcdef1234567890");
  });

  it("strips outer double quotes from raw value", () => {
    const input = '"my-cookie-or-token"';
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "raw");
    expect(result!.credential).toBe("my-cookie-or-token");
  });

  it("strips outer single quotes from raw value", () => {
    const input = "'raw_token_value'";
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "raw");
    expect(result!.credential).toBe("raw_token_value");
  });

  // ── strings with = and ; ─────────────────────────────────────────────────

  it("handles raw cookie-like string with = and ;", () => {
    const input = "session_id=abc123; Path=/; Secure; HttpOnly";
    const result = parseWebSessionCredential(input);
    // This looks like a standalone Cookie header value (no "Cookie:" prefix),
    // so it falls to raw
    expectOrigin(result, "raw");
    expect(result!.credential).toBe(
      "session_id=abc123; Path=/; Secure; HttpOnly",
    );
  });

  it("handles Cookie header with = and ; characters", () => {
    const input = "Cookie: a=1; b=2; c=3";
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "header-cookie");
    expect(result!.credential).toBe("a=1; b=2; c=3");
  });

  // ── precedence: header-cookie vs header-authorization ────────────────────

  it("prefers Authorization header over Cookie header when both standalone", () => {
    // Both appear as standalone lines; Authorization regex is checked first
    const input = "Authorization: Bearer my-token\nCookie: session=abc";
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "header-authorization");
    expect(result!.credential).toBe("my-token");
  });

  // ── edge cases ───────────────────────────────────────────────────────────

  it("handles cURL with many flags and only non-auth headers", () => {
    const input = `curl -X POST https://api.example.com -H 'Content-Type: application/json' -d '{"prompt":"hi"}'`;
    const result = parseWebSessionCredential(input);
    // No auth/cookie headers → falls through to raw (the whole trimmed string)
    expect(result).not.toBeNull();
    expect(result!.origin).toBe("raw");
  });

  it("handles cURL with escaped quotes inside header value", () => {
    const input = `curl -H "Cookie: name=\\"quoted\\"" https://example.com`;
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "curl-cookie");
    // The regex captures the content between the outer double quotes
    expect(result!.credential).toContain("name=");
  });

  it("handles Bearer token with extra whitespace", () => {
    const input = "Authorization:    Bearer    spaced-token   ";
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "header-authorization");
    expect(result!.credential).toBe("spaced-token");
  });

  it("handles JSON with nested objects", () => {
    const input = '{"headers":{"Authorization":"Bearer nested"},"extra":true}';
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "json");
    expect(result!.credential).toBe(
      '{"headers":{"Authorization":"Bearer nested"},"extra":true}',
    );
  });

  it("does not treat non-object JSON (number) as json credential", () => {
    const result = parseWebSessionCredential("42");
    expectOrigin(result, "raw");
    expect(result!.credential).toBe("42");
  });

  it("handles cURL with -b flag and double quotes containing = and ;", () => {
    const input = `curl -b "id=abc; Path=/; Domain=.example.com" https://example.com`;
    const result = parseWebSessionCredential(input);
    expectOrigin(result, "curl-cookie");
    expect(result!.credential).toBe("id=abc; Path=/; Domain=.example.com");
  });
});
