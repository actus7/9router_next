import { describe, expect, it } from "vitest";
import { getCloudTool, listCloudTools } from "@/server/cloud/tools/registry";

describe("cloud tool registry", () => {
  it("resolves the openclaw manifest by id", () => {
    const tool = getCloudTool("openclaw");
    expect(tool?.id).toBe("openclaw");
    expect(tool?.image).toBe("ghcr.io/openclaw/openclaw:latest");
  });

  it("returns null for an unknown tool id", () => {
    expect(getCloudTool("does-not-exist")).toBeNull();
  });

  it("lists at least the openclaw tool", () => {
    expect(listCloudTools().some((t) => t.id === "openclaw")).toBe(true);
  });

  it("builds env vars containing the gateway token and api url", () => {
    const tool = getCloudTool("openclaw")!;
    const env = tool.buildEnv({
      gatewayToken: "tok123",
      gatewayApiUrl: "https://squid.example.com/v1",
      gatewayApiKey: "sk-test",
      model: "gpt-4o",
      provider: "openai",
      serviceUrl: "https://squid-openclaw.onrender.com",
    });
    expect(env.find((e) => e.key === "OPENCLAW_GATEWAY_TOKEN")?.value).toBe("tok123");
    expect(env.find((e) => e.key === "OPENAI_BASE_URL")?.value).toBe("https://squid.example.com/v1");
  });
});
