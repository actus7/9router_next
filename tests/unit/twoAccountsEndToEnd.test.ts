import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnections: vi.fn(async () => [{ id: "c1", priority: 1 }, { id: "c2", priority: 2 }]),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(async () => ({ providerStrategies: {}, fallbackStrategy: "fill-first", stickyRoundRobinLimit: 1 })),
}));
vi.mock("@/lib/db/repos/proxyPoolsRepo", () => ({ getProxyPools: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos/modelAvailabilityRepo", () => ({
  getActiveModelAvailability: vi.fn(async () => []),
  setModelAvailability: vi.fn(),
  clearModelAvailability: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})), pickProxyPoolId: vi.fn(() => null) }));

import { getProviderCredentials } from "@/server/llm-gateway/auth/accountSelection";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import { attachEntryConfigs, getEntryConfig } from "@/server/llm-gateway/engine/host/entryConfig";
import { expandEntryCandidates } from "@/server/llm-gateway/engine/services/smart-routing/entries";
import { normalizeSmartRoutingConfig } from "@/server/llm-gateway/engine/services/smart-routing/router";
import { clearModelPenalties } from "@/server/llm-gateway/engine/services/modelPenalty";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe("one model on two accounts, from stored config to the account that answers", () => {
  it("tries the first entry's account, then the second's — never the other way round", async () => {
    clearModelPenalties();
    const config = normalizeSmartRoutingConfig({
      overrides: { general: { standard: ["claude/m", "claude/m"] } },
      entries: { general: { standard: [{ connectionId: "c2" }, { connectionId: "c1" }] } },
    });
    const { candidates, entryConfigs } = expandEntryCandidates(
      [{ modelKey: "claude/m", tier: "standard", degraded: false, source: "manual", score: 2, column: true }], config, "general");
    expect(candidates).toHaveLength(2);

    const body: Record<string, unknown> = {};
    attachEntryConfigs(body, entryConfigs);
    const used: string[] = [];
    const res = await handleComboChat({
      body,
      models: candidates.map((c) => c.modelKey),
      handleSingleModel: async (b, model) => {
        const credentials = await getProviderCredentials("claude", null, model.split("/")[1], { onlyConnectionId: getEntryConfig(b)?.connectionId });
        used.push(String(credentials?.connectionId));
        return used.length === 1 ? new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 }) : new Response("{}", { status: 200 });
      },
      log,
      comboName: "dev",
      autoSwitch: false,
    });
    expect(res.ok).toBe(true);
    expect(used).toEqual(["c2", "c1"]);
  });
});
