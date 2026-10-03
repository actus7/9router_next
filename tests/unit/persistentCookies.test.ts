import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Persistent sign-in ("remember me"): the flag cookie the auth UI cannot set
 * (`AuthView` from `@neondatabase/auth` has no checkbox) turned into
 * `Max-Age`/`Expires` on the auth cookies. Fail-open by construction — with the
 * flag absent every header must come back byte-identical, and a deletion
 * cookie must never be extended or sign-out would leave the session behind for
 * 30 days.
 */

import {
  extendAuthCookies,
  extendResponseSetCookies,
  hasRememberMeFlag,
} from "@/lib/auth/persistentCookies";

const NOW = new Date("2026-10-03T12:00:00.000Z");
const THIRTY_DAYS_SECONDS = 2592000;

function expiresOf(maxAgeSeconds: number): string {
  return new Date(NOW.getTime() + maxAgeSeconds * 1000).toUTCString();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("extendAuthCookies", () => {
  const sessionCookie = "__Secure-neon-auth.session_token=abc.def; Path=/; HttpOnly; Secure; SameSite=Lax";

  it("adds Max-Age and Expires when the remember-me flag is on", () => {
    const [extended] = extendAuthCookies([sessionCookie], true);

    expect(extended).toContain("Max-Age=2592000");
    expect(extended).toContain(`Expires=${expiresOf(THIRTY_DAYS_SECONDS)}`);
  });

  it("replaces an existing Max-Age/Expires instead of duplicating them", () => {
    // Expires must be in the future here: a past one reads as a deletion.
    const [extended] = extendAuthCookies(
      ["sid=abc; Path=/; Max-Age=60; Expires=Fri, 01 Jan 2030 00:00:00 GMT"],
      true,
    );

    expect(extended.match(/max-age=/gi)).toHaveLength(1);
    expect(extended.match(/expires=/gi)).toHaveLength(1);
    expect(extended).toContain("Max-Age=2592000");
    expect(extended).toContain(`Expires=${expiresOf(THIRTY_DAYS_SECONDS)}`);
    expect(extended).not.toContain("Max-Age=60");
    expect(extended).not.toContain("01 Jan 2030");
  });

  it("preserves every other attribute and the cookie pair itself", () => {
    const [extended] = extendAuthCookies([sessionCookie], true);

    expect(extended.startsWith("__Secure-neon-auth.session_token=abc.def")).toBe(true);
    expect(extended).toContain("Path=/");
    expect(extended).toContain("HttpOnly");
    expect(extended).toContain("Secure");
    expect(extended).toContain("SameSite=Lax");
  });

  it("honours a custom max-age and writes an HTTP-date Expires", () => {
    const [extended] = extendAuthCookies(["sid=abc"], true, 3600);

    expect(extended).toContain("Max-Age=3600");
    expect(extended).toContain(`Expires=${expiresOf(3600)}`);
    expect(extended).toMatch(/Expires=[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT/);
  });

  describe("never extends a deletion cookie", () => {
    const deletions = [
      "sid=; Path=/; Max-Age=0",
      "sid=abc; max-age=0; Path=/",
      "sid=abc; MAX-AGE=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      "sid=abc; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ];

    it.each(deletions)("returns the header intact: %s", (header) => {
      expect(extendAuthCookies([header], true)).toEqual([header]);
    });
  });

  it("extends the cookies around a deletion, not the deletion itself", () => {
    const deletion = "sid=; Path=/; Max-Age=0";
    const [extended, untouched] = extendAuthCookies([sessionCookie, deletion], true);

    expect(extended).toContain("Max-Age=2592000");
    expect(untouched).toBe(deletion);
  });

  it("is idempotent when the flag is off", () => {
    const headers = [
      sessionCookie,
      "sid=; Max-Age=0",
      "sid=old; Max-Age=60; Expires=Fri, 01 Jan 2030 00:00:00 GMT",
    ];

    expect(extendAuthCookies(headers, false)).toEqual(headers);
    expect(extendAuthCookies(headers, false)).toBe(headers);
  });
});

describe("hasRememberMeFlag", () => {
  it("reads the flag from a cookie header", () => {
    expect(hasRememberMeFlag("remember_me=1")).toBe(true);
  });

  it("reads the flag among other cookies", () => {
    expect(hasRememberMeFlag("a=b; remember_me=1; c=d")).toBe(true);
  });

  it("is false when the header is absent or empty", () => {
    expect(hasRememberMeFlag(null)).toBe(false);
    expect(hasRememberMeFlag("")).toBe(false);
  });

  it("is false when the flag is missing or not exactly 1", () => {
    expect(hasRememberMeFlag("a=b; c=d")).toBe(false);
    expect(hasRememberMeFlag("remember_me=0")).toBe(false);
    expect(hasRememberMeFlag("remember_me=10")).toBe(false);
    expect(hasRememberMeFlag("remember_me_extra=1")).toBe(false);
    expect(hasRememberMeFlag("myremember_me=1")).toBe(false);
  });
});

describe("extendResponseSetCookies", () => {
  it("keeps one header line per cookie and leaves other headers alone", () => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("Set-Cookie", "sid=abc; Path=/; HttpOnly");
    headers.append("Set-Cookie", "sid=; Path=/; Max-Age=0");

    extendResponseSetCookies(headers, true);

    const cookies = headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("Max-Age=2592000");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[1]).toBe("sid=; Path=/; Max-Age=0");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("touches nothing when the flag is off", () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "sid=abc; Path=/");

    extendResponseSetCookies(headers, false);

    expect(headers.getSetCookie()).toEqual(["sid=abc; Path=/"]);
  });
});
