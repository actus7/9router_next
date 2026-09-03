import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";

const execAsync = promisify(exec);
const PROVIDER_NAME = "modelhub";

const getDeepSeekDir = () => path.join(os.homedir(), ".deepseek");
const getDeepSeekConfigPath = () => path.join(getDeepSeekDir(), "config.toml");

const parseToml = (content: string): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  let currentSection: Record<string, string> = result as Record<string, string>;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1];
      if (!result[sectionName]) result[sectionName] = {};
      currentSection = result[sectionName] as Record<string, string>;
      continue;
    }
    const keyValueMatch = trimmed.match(/^(\w+)\s*=\s*"([^"]*)"$/);
    if (keyValueMatch) {
      currentSection[keyValueMatch[1]] = keyValueMatch[2];
      continue;
    }
    const unquotedMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (unquotedMatch) {
      currentSection[unquotedMatch[1]] = unquotedMatch[2].trim();
    }
  }
  return result;
};

const buildModelHubConfig = (baseUrl: string, apiKey: string, model: string) => {
  const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  return `provider = "openai"

[providers.openai]
base_url = "${normalizedBaseUrl}"
api_key = "${apiKey}"
model = "${model}"
`;
};

const DEFAULT_CONFIG = `provider = "deepseek"
`;

const checkDeepSeekInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    await execAsync(isWindows ? "where deepseek" : "which deepseek", { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getDeepSeekConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readConfigToml = async () => {
  try {
    return await fs.readFile(getDeepSeekConfigPath(), "utf-8");
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
};

const hasModelHubConfig = (config: Record<string, unknown>) => {
  if (!config) return false;
  if (config.provider !== "openai") return false;
  const openaiSection = config["providers.openai"] as Record<string, string> | undefined;
  if (!openaiSection?.base_url) return false;
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(openaiSection.base_url);
};

async function handleGet() {
  const installed = await checkDeepSeekInstalled();
  if (!installed) {
    return { installed: false, settings: null, message: "DeepSeek TUI is not installed" };
  }
  const toml = await readConfigToml();
  const config = parseToml(toml);
  return {
    installed: true,
    settings: config,
    hasModelHub: hasModelHubConfig(config),
    configPath: getDeepSeekConfigPath(),
  };
}

async function handlePost(body: Record<string, unknown>) {
  const { baseUrl, apiKey, model } = body;
  if (!baseUrl || !model) {
    throw new HttpValidationError("baseUrl and model are required", 400);
  }
  await fs.mkdir(getDeepSeekDir(), { recursive: true });
  const newConfig = buildModelHubConfig(String(baseUrl), typeof apiKey === "string" ? apiKey : "sk_modelhub", String(model));
  await fs.writeFile(getDeepSeekConfigPath(), newConfig);
  return {
    success: true,
    message: "DeepSeek TUI settings applied successfully!",
    configPath: getDeepSeekConfigPath(),
  };
}

async function handleDelete() {
  const configPath = getDeepSeekConfigPath();
  try {
    await fs.access(configPath);
  } catch {
    return { success: true, message: "No config file to reset" };
  }
  await fs.writeFile(configPath, DEFAULT_CONFIG);
  return { success: true, message: `${PROVIDER_NAME} config reset to DeepSeek defaults` };
}

export const { GET, POST, DELETE } = createCliToolHandlers("deepseek-tui", {
  get: handleGet,
  post: handlePost,
  delete: handleDelete,
});
