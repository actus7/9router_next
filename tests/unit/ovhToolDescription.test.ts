import { describe, expect, it } from "vitest";
import { getExecutor } from "@/server/llm-gateway/engine/executors";

const transform = (provider: string, model: string, body: unknown) =>
  (getExecutor(provider) as { transformRequest: (m: string, b: unknown) => unknown }).transformRequest(model, body);

const tool = (fn: Record<string, unknown>) => ({ type: "function", function: { name: "get_weather", parameters: { type: "object" }, ...fn } });

describe("OVH tool description quirk", () => {
  it("fills a missing tool description, which OVH rejects with 400", () => {
    const body = { model: "gpt-oss-20b", messages: [], tools: [tool({}), tool({ description: "keep" })] };
    const callerTool = body.tools[0];
    const out = transform("ovh", "gpt-oss-20b", body) as { tools: Array<{ function: { description: string } }> };
    expect(out.tools.map((t) => t.function.description)).toEqual(["", "keep"]);
    expect(callerTool.function).not.toHaveProperty("description");
  });

  it("leaves providers without the quirk untouched", () => {
    const body = { model: "m", messages: [], tools: [tool({})] };
    const out = transform("groq", "m", body) as { tools: Array<{ function: Record<string, unknown> }> };
    expect(out.tools[0].function).not.toHaveProperty("description");
  });
});
