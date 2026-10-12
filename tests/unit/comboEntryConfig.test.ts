import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import { clearModelPenalties } from "@/server/llm-gateway/engine/services/modelPenalty";
import { attachEntryConfigs, getEntryConfig, setEntryConfig } from "@/server/llm-gateway/engine/host/entryConfig";
import { applyConfiguredEntryParams } from "@/server/llm-gateway/engine/services/modelParams";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const ok = () => new Response("{}", { status: 200 });
const fail = () => new Response(JSON.stringify({ error: { message: "x" } }), { status: 500 });

describe("entry config on the request", () => {
  it("rides the body through a spread copy, and clears", () => {
    const body: Record<string, unknown> = {};
    setEntryConfig(body, { connectionId: "c1", params: { temperature: 0.2 } });
    expect(getEntryConfig({ ...body })).toEqual({ connectionId: "c1", params: { temperature: 0.2 } });
    setEntryConfig(body, undefined);
    expect(getEntryConfig(body)).toBeUndefined();
  });
});

describe("combo hands each attempt its own entry config", () => {
  it("gives two entries of the same model their own account, in order, and nothing to the next model", async () => {
    clearModelPenalties();
    const seen: Array<[string, unknown]> = [];
    const body: Record<string, unknown> = {};
    attachEntryConfigs(body, new Map([["codex/gpt-5.6-terra", [{ connectionId: "chat" }, { connectionId: "rob" }]]]));
    await handleComboChat({
      body,
      models: ["codex/gpt-5.6-terra", "codex/gpt-5.6-terra", "glm/glm-5.3"],
      handleSingleModel: async (body, model) => {
        seen.push([model, getEntryConfig(body)?.connectionId]);
        return seen.length < 3 ? fail() : ok();
      },
      log,
      comboName: "dev",
      autoSwitch: false,
    });
    expect(seen).toEqual([["codex/gpt-5.6-terra", "chat"], ["codex/gpt-5.6-terra", "rob"], ["glm/glm-5.3", undefined]]);
  });
});

describe("applyConfiguredEntryParams", () => {
  it("resolves the catalog model from the upstream id and applies the values", () => {
    const out = applyConfiguredEntryParams({ model: "glm-5.3", temperature: 1 }, "glm-5.3", { temperature: 0.2 }, "apikey");
    expect(out.temperature).toBe(0.2);
  });

  it("leaves a model without a catalog entry untouched, however much is configured", () => {
    const body = { model: "space-bunny-free", temperature: 1 };
    expect(applyConfiguredEntryParams(body, "space-bunny-free", { temperature: 0.2 }, "apikey")).toEqual(body);
  });
});

import { preferWarmModel, rememberWarmModel } from "@/server/llm-gateway/engine/services/comboCacheAffinity";

describe("cache affinity with one model on two accounts", () => {
  it("moves every copy of the warm model to the front and keeps both", () => {
    rememberWarmModel("sess-dup", "dev", "b/m");
    expect(preferWarmModel(["a/m", "b/m", "c/m", "b/m"], "dev", "sess-dup")).toEqual(["b/m", "b/m", "a/m", "c/m"]);
  });
});
