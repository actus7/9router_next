import fs from "fs/promises";
import path from "path";
import os from "os";
import { DEFAULT_PLUGINS } from "@/shared/constants/coworkPlugins";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";
import { checkCliOnPath } from "@/server/application/use-cases/http/cli-tools/cliToolIo";

// Exa MCP def — reuse from coworkPlugins (DRY).
const EXA_PLUGIN = DEFAULT_PLUGINS.find((p) => p.name === "exa");
const buildExaMcpEntry = () => ({
  type: EXA_PLUGIN!.transport,
  url: EXA_PLUGIN!.url,
});

// Get claude settings path based on OS
const getClaudeSettingsPath = () => {
  const homeDir = os.homedir();
  return path.join(homeDir, ".claude", "settings.json");
};

// Claude Code CLI reads mcpServers from ~/.claude.json (NOT settings.json).
const getClaudeJsonPath = () => path.join(os.homedir(), ".claude.json");

const readClaudeJson = async () => {
  try {
    const content = await fs.readFile(getClaudeJsonPath(), "utf-8");
    return JSON.parse(content.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
};

const writeClaudeJsonMcp = async (mcpServers: Record<string, unknown> | null) => {
  const filePath = getClaudeJsonPath();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch (error: unknown) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    data.mcpServers = { ...((data.mcpServers as Record<string, unknown>) || {}), ...mcpServers };
  } else if (data.mcpServers) {
    delete (data.mcpServers as Record<string, unknown>).exa;
    if (Object.keys(data.mcpServers as Record<string, unknown>).length === 0) delete data.mcpServers;
  }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
};


const checkClaudeInstalled = async () => checkCliOnPath("claude", getClaudeSettingsPath());

// Read current settings
const readSettings = async () => {
  try {
    const settingsPath = getClaudeSettingsPath();
    const content = await fs.readFile(settingsPath, "utf-8");
    // Tolerate JSONC (trailing commas) and treat unparseable files as "no config"
    // rather than throwing a 500 that the UI misreads as "tool not installed".
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch  {
    return null;
  }
};

async function handleGet() {
  const isInstalled = await checkClaudeInstalled();

  if (!isInstalled) {
    return {
      installed: false,
      settings: null,
      message: "Claude CLI is not installed",
    };
  }

  const settings = await readSettings();
  const hasModelHub = !!(settings?.env?.ANTHROPIC_BASE_URL);
  const claudeJson = await readClaudeJson();

  return {
    installed: true,
    settings,
    hasModelHub,
    exaMcpEnabled: !!claudeJson?.mcpServers?.exa,
    settingsPath: getClaudeSettingsPath(),
  };
}

async function handlePost(body: Record<string, unknown>) {
  const { env, exaMcpEnabled, maxContextTokens } = body;

  if (!env || typeof env !== "object") {
    throw new HttpValidationError("Invalid env object", 400);
  }

  const settingsPath = getClaudeSettingsPath();
  const claudeDir = path.dirname(settingsPath);
  await fs.mkdir(claudeDir, { recursive: true });

  let currentSettings: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(settingsPath, "utf-8");
    currentSettings = JSON.parse(content);
  } catch (error: unknown) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const envObj = { ...(env as Record<string, unknown>) };
  if (envObj.ANTHROPIC_BASE_URL) {
    envObj.ANTHROPIC_BASE_URL = String(envObj.ANTHROPIC_BASE_URL).endsWith("/v1")
      ? envObj.ANTHROPIC_BASE_URL
      : `${envObj.ANTHROPIC_BASE_URL}/v1`;
  }

  const newSettings: Record<string, unknown> = {
    ...currentSettings,
    hasCompletedOnboarding: true,
    env: {
      ...((currentSettings.env as Record<string, unknown>) || {}),
      ...envObj,
    },
  };

  const mergedEnv = newSettings.env as Record<string, unknown>;
  if (maxContextTokens) {
    mergedEnv.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(maxContextTokens);
  } else {
    delete mergedEnv.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
  }

  await fs.writeFile(settingsPath, JSON.stringify(newSettings, null, 2));

  if (EXA_PLUGIN) {
    await writeClaudeJsonMcp(exaMcpEnabled ? { exa: buildExaMcpEntry() } : null);
  }

  return {
    success: true,
    message: "Settings updated successfully",
  };
}

const RESET_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "API_TIMEOUT_MS",
  "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
];

async function handleDelete() {
  const settingsPath = getClaudeSettingsPath();

  let currentSettings: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(settingsPath, "utf-8");
    currentSettings = JSON.parse(content);
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: true, message: "No settings file to reset" };
    }
    throw error;
  }

  if (currentSettings.env) {
    const envObj = currentSettings.env as Record<string, unknown>;
    RESET_ENV_KEYS.forEach((key) => {
      delete envObj[key];
    });
    if (Object.keys(envObj).length === 0) {
      delete currentSettings.env;
    }
  }

  await writeClaudeJsonMcp(null);
  await fs.writeFile(settingsPath, JSON.stringify(currentSettings, null, 2));

  return {
    success: true,
    message: "Settings reset successfully",
  };
}

export const { GET, POST, DELETE } = createCliToolHandlers("claude", {
  get: handleGet,
  post: handlePost,
  delete: handleDelete,
});
