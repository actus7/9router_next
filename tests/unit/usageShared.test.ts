import { describe, expect, it, vi } from "vitest";

import {
  normalizeCloudCodeProjectId,
  parseResetTime,
  toFiniteNumber,
} from "@/server/llm-gateway/engine/services/usage/shared";

/**
 * The helpers every provider's quota reader goes through.
 *
 * `engine/services/usage` was at 0% -- fourteen files, none of them touched by
 * a test -- and these three are the shared floor underneath all of them. They
 * turn whatever a provider's API happened to send into the numbers and dates
 * the dashboard shows, which makes them exactly the kind of code that fails
 * quietly: a reset date parsed wrong reads as a plausible date, and a quota
 * parsed wrong reads as a plausible quota.
 */

describe("parseResetTime", () => {
  it("reads a Unix timestamp in seconds as seconds", () => {
    // 2026-01-01T00:00:00Z. Providers send both units and say which in neither.
    expect(parseResetTime(1767225600)).toBe("2026-01-01T00:00:00.000Z");
  });

  it("reads a Unix timestamp in milliseconds as milliseconds", () => {
    expect(parseResetTime(1767225600000)).toBe("2026-01-01T00:00:00.000Z");
  });

  it("applies the same unit guess to a numeric string", () => {
    // Providers that send the timestamp as a JSON string are not sending a date.
    expect(parseResetTime("1767225600")).toBe("2026-01-01T00:00:00.000Z");
    expect(parseResetTime("1767225600000")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("keeps an ISO string as the instant it names", () => {
    expect(parseResetTime("2026-01-01T00:00:00.000Z")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("accepts a Date as given", () => {
    expect(parseResetTime(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01T00:00:00.000Z");
  });

  it("answers null rather than throwing on something that is not a date", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // `new Date("amanhã").toISOString()` throws a RangeError. Letting that out
    // would fail a whole usage read over one unparseable field.
    expect(parseResetTime("amanha")).toBeNull();
    warn.mockRestore();
  });

  it("treats absence as absence, not as the epoch", () => {
    expect(parseResetTime(null)).toBeNull();
    expect(parseResetTime(undefined)).toBeNull();
    // Falsy, and the epoch is never a real reset time.
    expect(parseResetTime(0)).toBeNull();
    expect(parseResetTime({})).toBeNull();
  });
});

describe("toFiniteNumber", () => {
  it("takes a finite number as it is", () => {
    expect(toFiniteNumber(42)).toBe(42);
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber(-1.5)).toBe(-1.5);
  });

  it("parses a numeric string, which is how JSON quotas often arrive", () => {
    expect(toFiniteNumber("42")).toBe(42);
    expect(toFiniteNumber(" 7 ")).toBe(7);
  });

  it("falls back rather than propagating NaN or Infinity", () => {
    // A NaN quota renders as "NaN" in the dashboard and compares false against
    // every threshold, so it must never leave here.
    expect(toFiniteNumber(Number.NaN)).toBe(0);
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toFiniteNumber("ilimitado")).toBe(0);
    expect(toFiniteNumber(null)).toBe(0);
    expect(toFiniteNumber(undefined)).toBe(0);
    expect(toFiniteNumber("")).toBe(0);
  });

  it("uses the caller's fallback when one is given", () => {
    expect(toFiniteNumber("ilimitado", -1)).toBe(-1);
    expect(toFiniteNumber(undefined, 100)).toBe(100);
  });
});

describe("normalizeCloudCodeProjectId", () => {
  it("accepts either the id or the object that carries it", () => {
    expect(normalizeCloudCodeProjectId("proj-1")).toBe("proj-1");
    expect(normalizeCloudCodeProjectId({ id: "proj-1" })).toBe("proj-1");
  });

  it("trims, because a padded id is not a different project", () => {
    expect(normalizeCloudCodeProjectId("  proj-1  ")).toBe("proj-1");
    expect(normalizeCloudCodeProjectId({ id: " proj-1 " })).toBe("proj-1");
  });

  it("answers null for anything that is not an id", () => {
    // An empty string would be sent to the provider as a project name.
    expect(normalizeCloudCodeProjectId("")).toBeNull();
    expect(normalizeCloudCodeProjectId("   ")).toBeNull();
    expect(normalizeCloudCodeProjectId({ id: "  " })).toBeNull();
    expect(normalizeCloudCodeProjectId({ name: "proj-1" })).toBeNull();
    expect(normalizeCloudCodeProjectId(null)).toBeNull();
    expect(normalizeCloudCodeProjectId(42)).toBeNull();
  });
});
