import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/llm-gateway/application/modelResolution", () => ({
  // "dev" is a combo (no provider); "codex/gpt-5" is the canonical id of "cx/gpt-5".
  getModelInfo: vi.fn(async (model: string) =>
    model === "cx/gpt-5" ? { provider: "codex", model: "gpt-5" } : { provider: null, model },
  ),
}));

import {
  assertModelAllowed,
  filterByAccess,
  isAllowedByAccess,
  runModelAuthorized,
  withAccessLayers,
} from "@/server/llm-gateway/application/accessScope";

describe("assertModelAllowed", () => {
  it("lets everything through outside any scope (internal callers)", async () => {
    expect(await assertModelAllowed("anything/at-all")).toBeNull();
  });

  it("answers 403 naming the model when the policy does not list it", async () => {
    const denied = await withAccessLayers([{ models: ["dev"] }], () => assertModelAllowed("kr/claude-sonnet-4"));
    expect(denied?.status).toBe(403);
    const body = (await denied?.json()) as { error: { message: string; type: string; code: string } };
    expect(body.error.message).toContain("kr/claude-sonnet-4");
    expect(body.error).toMatchObject({ type: "permission_error", code: "model_not_allowed" });
  });

  it("matches the resolved provider/model spelling too", async () => {
    const allowed = await withAccessLayers([{ models: ["codex/*"] }], () => assertModelAllowed("cx/gpt-5"));
    expect(allowed).toBeNull();
  });

  it("does not re-check the members an allowed combo routes to", async () => {
    const result = await withAccessLayers([{ models: ["dev"] }], async () => {
      expect(await assertModelAllowed("dev")).toBeNull();
      return runModelAuthorized(() => assertModelAllowed("kr/claude-sonnet-4"));
    });
    expect(result).toBeNull();
  });

  it("checks again outside the authorized re-entry", async () => {
    const result = await withAccessLayers([{ models: ["dev"] }], async () => {
      await runModelAuthorized(async () => undefined);
      return assertModelAllowed("kr/claude-sonnet-4");
    });
    expect(result?.status).toBe(403);
  });

  it("refuses everything for an empty model list", async () => {
    const denied = await withAccessLayers([{ models: [] }], () => assertModelAllowed("dev"));
    expect(denied?.status).toBe(403);
  });
});

describe("plugins and skills", () => {
  it("filters by every layer and allows what no layer restricts", () => {
    withAccessLayers([{ skills: ["a", "b"] }, { skills: ["b"], plugins: ["memory"] }], () => {
      expect(filterByAccess("skills", ["a", "b", "c"])).toEqual(["b"]);
      expect(isAllowedByAccess("plugins", "memory")).toBe(true);
      expect(isAllowedByAccess("plugins", "web-search")).toBe(false);
    });
    expect(isAllowedByAccess("plugins", "web-search")).toBe(true);
  });
});
