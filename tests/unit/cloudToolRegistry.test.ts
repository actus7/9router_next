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

  it("buildInfo derives webSocketUrl from serviceUrl (https → wss)", () => {
    const tool = getCloudTool("openclaw")!;
    const info = tool.buildInfo({
      gatewayToken: "tok123",
      gatewayApiUrl: "https://squid.example.com/v1",
      gatewayApiKey: "sk-test",
      model: "gpt-4o",
      provider: "openai",
      serviceUrl: "https://squid-openclaw.onrender.com",
    });
    expect(info.webSocketUrl).toBe("wss://squid-openclaw.onrender.com");
  });

  it("buildInfo derives webSocketUrl from serviceUrl (http → ws)", () => {
    const tool = getCloudTool("openclaw")!;
    const info = tool.buildInfo({
      gatewayToken: "tok123",
      gatewayApiUrl: "http://localhost:8000",
      gatewayApiKey: "sk-test",
      model: "gpt-4o",
      provider: "openai",
      serviceUrl: "http://localhost:3000",
    });
    expect(info.webSocketUrl).toBe("ws://localhost:3000");
  });

  it("buildInfo normalizes and deduplicates allowedOrigins", () => {
    const tool = getCloudTool("openclaw")!;
    const info = tool.buildInfo({
      gatewayToken: "tok123",
      gatewayApiUrl: "https://squid.example.com/v1",
      gatewayApiKey: "sk-test",
      model: "gpt-4o",
      provider: "openai",
      serviceUrl: "https://squid-openclaw.onrender.com",
      allowedOrigins: ["https://squid.example.com", "https://squid.example.com/v1", "https://other.com"],
    });
    expect(info.allowedOrigins).toContain("https://squid-openclaw.onrender.com");
    expect(info.allowedOrigins).toContain("https://squid.example.com");
    expect(info.allowedOrigins).toContain("https://other.com");
    expect(info.allowedOrigins.length).toBe(3);
  });

  it("buildInfo sets controlUiUrl to normalized serviceUrl origin", () => {
    const tool = getCloudTool("openclaw")!;
    const info = tool.buildInfo({
      gatewayToken: "tok123",
      gatewayApiUrl: "https://squid.example.com/v1",
      gatewayApiKey: "sk-test",
      model: "gpt-4o",
      provider: "openai",
      serviceUrl: "https://squid-openclaw.onrender.com/some/path",
    });
    expect(info.controlUiUrl).toBe("https://squid-openclaw.onrender.com");
  });

  it("buildInfo constructs healthUrl and readyUrl correctly", () => {
    const tool = getCloudTool("openclaw")!;
    const info = tool.buildInfo({
      gatewayToken: "tok123",
      gatewayApiUrl: "https://squid.example.com/v1",
      gatewayApiKey: "sk-test",
      model: "gpt-4o",
      provider: "openai",
      serviceUrl: "https://squid-openclaw.onrender.com",
    });
    expect(info.healthUrl).toBe("https://squid-openclaw.onrender.com/healthz");
    expect(info.readyUrl).toBe("https://squid-openclaw.onrender.com/readyz");
  });

  it("buildEnv embeds OPENCLAW_CONFIG_JSON with correct structure", () => {
    const tool = getCloudTool("openclaw")!;
    const env = tool.buildEnv({
      gatewayToken: "tok123",
      gatewayApiUrl: "https://squid.example.com/v1",
      gatewayApiKey: "sk-test",
      model: "gpt-4o",
      provider: "openai",
      serviceUrl: "https://squid-openclaw.onrender.com",
    });
    const configJsonEntry = env.find((e) => e.key === "OPENCLAW_CONFIG_JSON");
    expect(configJsonEntry).toBeDefined();

    const config = JSON.parse(configJsonEntry!.value);
    expect(config.gateway.port).toBe(10000);
    expect(config.gateway.mode).toBe("local");
    expect(config.gateway.http.endpoints.chatCompletions.enabled).toBe(true);
    expect(config.agents.defaults.timeoutSeconds).toBe(610);
    expect(config.models.providers.squid.baseUrl).toBe("https://squid.example.com/v1");
  });

  it("buildEnv disables non-essential plugins in OPENCLAW_CONFIG_JSON", () => {
    const tool = getCloudTool("openclaw")!;
    const env = tool.buildEnv({
      gatewayToken: "tok123",
      gatewayApiUrl: "https://squid.example.com/v1",
      gatewayApiKey: "sk-test",
      model: "gpt-4o",
      provider: "openai",
      serviceUrl: "https://squid-openclaw.onrender.com",
    });
    const configJsonEntry = env.find((e) => e.key === "OPENCLAW_CONFIG_JSON");
    expect(configJsonEntry).toBeDefined();

    const config = JSON.parse(configJsonEntry!.value);
    expect(config.plugins.entries.canvas.enabled).toBe(false);
    expect(config.plugins.entries["phone-control"].enabled).toBe(false);
    expect(config.plugins.entries["talk-voice"].enabled).toBe(false);
  });
});
