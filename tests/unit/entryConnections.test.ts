import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnections: vi.fn(async () => [{ id: "c1", provider: "codex" }, { id: "z1", provider: "glm" }]),
}));

import { findForeignEntryConnection } from "@/server/application/use-cases/smart-routing/entryConnections";
import { normalizeSmartRoutingConfig } from "@/server/llm-gateway/engine/services/smart-routing/router";

const cfg = (connectionId: string, model = "codex/gpt-5.6-terra") =>
  normalizeSmartRoutingConfig({ overrides: { general: { standard: [model] } }, entries: { general: { standard: [{ connectionId }] } } });

describe("findForeignEntryConnection", () => {
  it("accepts an account of the entry's own provider", async () => {
    expect(await findForeignEntryConnection(cfg("c1"))).toBeNull();
  });
  it("rejects an unknown id and another provider's account", async () => {
    expect(await findForeignEntryConnection(cfg("nope"))).toMatch(/connectionId/);
    expect(await findForeignEntryConnection(cfg("z1"))).toMatch(/codex/);
  });
  it("has nothing to check without entries", async () => {
    expect(await findForeignEntryConnection(normalizeSmartRoutingConfig({}))).toBeNull();
  });
});
