import { beforeEach, describe, expect, it, vi } from "vitest";

const jev = vi.hoisted(() => ({ isJevFeatureEnabled: vi.fn(async () => true), evaluateJev: vi.fn() }));
vi.mock("@/server/decisions/jev", () => jev);

import { selectToolsForTurn } from "@/server/harness/tools/toolSelection";

const tool = (name: string) => ({ type: "function", function: { name, description: `${name} tool` } });
const body = {
  model: "oc/x",
  messages: [{ role: "user", content: "translate 'bom dia' to English" }],
  tools: [tool("web_search"), tool("translate"), tool("generate_image")],
};

describe("selectToolsForTurn", () => {
  beforeEach(() => {
    jev.isJevFeatureEnabled.mockResolvedValue(true);
    jev.evaluateJev.mockReset();
  });

  it("drops only tools Jev is confident are irrelevant", async () => {
    jev.evaluateJev.mockResolvedValue({
      t0: { type: "boolean", probability: 0.3 },
      t1: { type: "boolean", probability: 0.97 },
      t2: { type: "boolean", probability: 0.02 },
    });
    const result = await selectToolsForTurn(body);
    expect((result.tools as Array<{ function: { name: string } }>).map((t) => t.function.name)).toEqual(["web_search", "translate"]);
    expect(jev.evaluateJev.mock.calls[0]![0]).toEqual({ request: "translate 'bom dia' to English" });
  });

  it("removes tools and tool_choice entirely when none survive", async () => {
    jev.evaluateJev.mockResolvedValue({
      t0: { type: "boolean", probability: 0 },
      t1: { type: "boolean", probability: 0 },
      t2: { type: "boolean", probability: 0 },
    });
    const result = await selectToolsForTurn({ ...body, tool_choice: "auto" });
    expect(result).not.toHaveProperty("tools");
    expect(result).not.toHaveProperty("tool_choice");
  });

  it.each([
    ["the feature is off", () => jev.isJevFeatureEnabled.mockResolvedValue(false), body],
    ["Jev is unreachable", () => jev.evaluateJev.mockResolvedValue(null), body],
    ["tool_choice forces a tool", () => undefined, { ...body, tool_choice: { type: "function", function: { name: "translate" } } }],
    ["there is a single tool", () => undefined, { ...body, tools: [tool("translate")] }],
  ])("returns the body untouched when %s", async (_label, arrange, input) => {
    arrange();
    expect(await selectToolsForTurn(input)).toBe(input);
  });
});
