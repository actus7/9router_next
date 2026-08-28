import type { CloudToolManifest, CloudToolEnvInput, CloudToolInfo } from "./types";

const OPENCLAW_PORT = 10000;
const OPENCLAW_CONFIG_PATH = "/tmp/openclaw-state/openclaw.json";
const OPENCLAW_AGENT_TIMEOUT_SECONDS = 610;
const OPENCLAW_PROVIDER_TIMEOUT_SECONDS = 600;

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function uniqueOrigins(origins: string[]): string[] {
  return Array.from(new Set(origins.map(normalizeOrigin).filter((o): o is string => !!o)));
}

function webSocketUrlFromServiceUrl(serviceUrl: string): string {
  const origin = normalizeOrigin(serviceUrl) ?? serviceUrl;
  return origin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

function buildInfo(input: CloudToolEnvInput): CloudToolInfo {
  const serviceOrigin = normalizeOrigin(input.serviceUrl) ?? input.serviceUrl;
  const gatewayOrigin = normalizeOrigin(input.gatewayApiUrl) ?? input.gatewayApiUrl;
  const allowedOrigins = uniqueOrigins([serviceOrigin, gatewayOrigin, ...(input.allowedOrigins ?? [])]);
  return {
    allowedOrigins,
    controlUiUrl: serviceOrigin,
    healthUrl: `${serviceOrigin}/healthz`,
    readyUrl: `${serviceOrigin}/readyz`,
    webSocketUrl: webSocketUrlFromServiceUrl(serviceOrigin),
    model: input.model,
    provider: input.provider,
  };
}

function buildRuntimeConfig(input: CloudToolEnvInput): Record<string, unknown> {
  const info = buildInfo(input);
  const modelReference = `squid/${info.model}`;
  return {
    agents: {
      defaults: {
        model: { primary: modelReference },
        models: { [modelReference]: { alias: info.model } },
        timeoutSeconds: OPENCLAW_AGENT_TIMEOUT_SECONDS,
      },
    },
    gateway: {
      auth: { mode: "token", token: "${OPENCLAW_GATEWAY_TOKEN}" },
      bind: "lan",
      controlUi: { allowedOrigins: info.allowedOrigins },
      http: { endpoints: { chatCompletions: { enabled: true } } },
      mode: "local",
      port: OPENCLAW_PORT,
    },
    models: {
      mode: "merge",
      providers: {
        squid: {
          api: "openai-completions",
          apiKey: "${OPENAI_API_KEY}",
          baseUrl: input.gatewayApiUrl,
          timeoutSeconds: OPENCLAW_PROVIDER_TIMEOUT_SECONDS,
          models: [{ contextWindow: 128000, id: info.model, input: ["text"], maxTokens: 32000, name: info.model }],
        },
      },
    },
    update: { checkOnStart: false },
    // Free-tier footprint reduction: keep the browser plugin but disable the
    // heaviest non-essential ones so a 512MB instance doesn't OOM.
    plugins: {
      entries: {
        canvas: { enabled: false },
        "phone-control": { enabled: false },
        "talk-voice": { enabled: false },
      },
    },
  };
}

function buildEnv(input: CloudToolEnvInput): Array<{ key: string; value: string }> {
  const info = buildInfo(input);
  return [
    { key: "OPENCLAW_GATEWAY_PORT", value: String(OPENCLAW_PORT) },
    { key: "OPENCLAW_GATEWAY_TOKEN", value: input.gatewayToken },
    { key: "OPENAI_API_KEY", value: input.gatewayApiKey },
    { key: "OPENAI_BASE_URL", value: input.gatewayApiUrl },
    { key: "OPENCLAW_CONFIG_PATH", value: OPENCLAW_CONFIG_PATH },
    { key: "OPENCLAW_NO_AUTO_UPDATE", value: "1" },
    { key: "OPENCLAW_STATE_DIR", value: "/tmp/openclaw-state" },
    { key: "OPENCLAW_WORKSPACE_DIR", value: "/tmp/openclaw-workspace" },
    { key: "OPENCLAW_CONFIG_JSON", value: JSON.stringify(buildRuntimeConfig(input)) },
    { key: "OPENCLAW_ALLOWED_ORIGINS", value: info.allowedOrigins.join(",") },
    { key: "OPENCLAW_CONTROL_UI_URL", value: info.controlUiUrl },
  ];
}

export const openclawManifest: CloudToolManifest = {
  id: "openclaw",
  name: "OpenClaw",
  icon: "/providers/openclaw.png",
  image: "ghcr.io/openclaw/openclaw:latest",
  port: OPENCLAW_PORT,
  startup: {
    configEnvVar: "OPENCLAW_CONFIG_JSON",
    configPath: OPENCLAW_CONFIG_PATH,
    runArgs: ["openclaw.mjs", "gateway", "run", "--bind", "lan"],
  },
  buildEnv,
  buildInfo,
};
