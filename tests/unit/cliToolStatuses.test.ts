import { describe, expect, it } from "vitest";
import { GET as allStatuses } from "@/server/application/use-cases/http/cli-tools/all-statuses/route";

/**
 * The 17 cli-tools routes were consolidated behind `createCliToolHandlers`, but the
 * factory's own tests only exercise synthetic handlers. This drives the real route
 * modules: `all-statuses` fans out to every tool getter and replaces a thrown error
 * with `null`, so asserting every entry is a well-formed payload is what actually
 * catches a handler that broke during the consolidation.
 */
describe("cli-tools status aggregation", () => {
  it("returns a well-formed payload for every registered tool", async () => {
    const response = await allStatuses();
    expect(response.status).toBe(200);

    const payload = (await response.json()) as Record<string, { installed?: unknown } | null>;
    const tools = Object.keys(payload);
    expect(tools.length).toBeGreaterThanOrEqual(14);

    const broken = tools.filter((tool) => {
      const entry = payload[tool];
      return entry === null || typeof entry?.installed !== "boolean";
    });
    expect(broken).toEqual([]);
  }, 30_000);
});
