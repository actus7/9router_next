import { describe, expect, it } from "vitest";
import { getStatusDisplay } from "@/app/(dashboard)/dashboard/providers/utils/providerHelpers";

/**
 * A provider card must not say "No connections" while connections exist. A
 * fresh OAuth/import leaves testStatus "unknown" — counted as neither
 * connected nor error — and the overview used to render that state as "No
 * connections", which reads as the accounts having vanished. The honest
 * answer is how many connections are waiting for their first test.
 *
 * getStatusDisplay returns plain React elements; the assertions walk their
 * props without a DOM.
 */
function flattenText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join(" ");
  const el = node as { props?: { children?: unknown } };
  return flattenText(el?.props?.children);
}

function variantOf(node: unknown): string | undefined {
  const el = node as { props?: { variant?: string } };
  return el?.props?.variant;
}

describe("getStatusDisplay", () => {
  it("counts untested connections instead of denying they exist", () => {
    const el = getStatusDisplay(0, 0, null, 3);
    expect(variantOf(el)).toBe("secondary");
    expect(flattenText(el)).toContain("3");
    expect(flattenText(el)).not.toMatch(/no connections/i);
  });

  it("still says no connections when there are none at all", () => {
    const el = getStatusDisplay(0, 0, null, 0);
    expect(flattenText(el)).toMatch(/no connections/i);
  });

  it("keeps the connected badge ahead of any fallback", () => {
    const parts = getStatusDisplay(2, 0, null, 3);
    expect(Array.isArray(parts)).toBe(true);
    expect(flattenText(parts)).toContain("2");
  });

  it("keeps the error badge when a connection failed its test", () => {
    const parts = getStatusDisplay(0, 1, "AUTH", 1);
    expect(Array.isArray(parts)).toBe(true);
    expect(flattenText(parts)).toContain("1");
    expect(flattenText(parts)).toContain("AUTH");
  });
});
