import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A prefix the registry does not know is looked up among the account's custom
 * nodes. That used to be three sequential queries, one per node type; it is one.
 */
const nodes = vi.hoisted(() => [
  { id: "emb-1", type: "custom-embedding", prefix: "shared" },
  { id: "anth-1", type: "anthropic-compatible", prefix: "shared" },
  { id: "anth-2", type: "anthropic-compatible", prefix: "claudeish" },
  { id: "other-1", type: "something-else", prefix: "odd" },
]);

vi.mock("@/lib/db/repos/nodesRepo", () => ({
  getProviderNodes: vi.fn(async (filter: { type?: string } = {}) =>
    nodes.filter((node) => !filter.type || node.type === filter.type)),
}));

import { getModelInfo } from "@/server/llm-gateway/application/modelResolution";
import { getProviderNodes } from "@/lib/db/repos/nodesRepo";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getModelInfo custom node prefixes", () => {
  it("resolves with a single nodes query", async () => {
    expect(await getModelInfo("claudeish/some-model")).toEqual({ provider: "anth-2", model: "some-model" });
    expect(vi.mocked(getProviderNodes)).toHaveBeenCalledTimes(1);
  });

  it("keeps the type precedence: anthropic-compatible before custom-embedding", async () => {
    expect((await getModelInfo("shared/x")).provider).toBe("anth-1");
  });

  it("ignores node types it never resolved", async () => {
    expect((await getModelInfo("odd/x")).provider).not.toBe("other-1");
  });
});
