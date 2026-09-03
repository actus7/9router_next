import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { parseTOML, stringifyTOML } from "confbox";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";

const execAsync = promisify(exec);

const getJcodeConfigDir = () => path.join(os.homedir(), ".jcode");
const getConfigPath = () => path.join(getJcodeConfigDir(), "config.toml");

const getProviderEnvPath = () => {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configDir, "jcode", "provider-modelhub.env");
};

const checkJcodeInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where jcode" : "which jcode";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getJcodeConfigDir());
      return true;
    } catch {
      return false;
    }
  }
};

const readConfig = async (): Promise<Record<string, unknown>> => {
  try {
    const configPath = getConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    return parseTOML(content) as Record<string, unknown>;
  } catch  {
    return { providers: {} };
  }
};

const hasModelHubConfig = (config: Record<string, unknown>) => {
  if (!config || !config.providers) return false;

  const providers = config.providers as Record<string, Record<string, unknown>>;

  if (providers["modelhub"]) return true;

  for (const [, provider] of Object.entries(providers)) {
    if ((provider as Record<string, unknown>).base_url && ((provider as Record<string, unknown>).base_url as string).includes("localhost:20128")) {
      return true;
    }
  }

  return false;
};

const writeConfig = async (config: Record<string, unknown>) => {
  const configPath = getConfigPath();
  const content = stringifyTOML(config);
  await fs.writeFile(configPath, content, "utf-8");
};

const readProviderEnv = async () => {
  try {
    const envPath = getProviderEnvPath();
    const content = await fs.readFile(envPath, "utf-8");
    const env: Record<string, string> = {};

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        env[key] = value;
      }
    }

    return env;
  } catch {
    return {};
  }
};

const writeProviderEnv = async (env: Record<string, string>) => {
  const envPath = getProviderEnvPath();
  let content = "# jcode provider environment variables\n";

  for (const [key, value] of Object.entries(env)) {
    content += `${key}="${value}"\n`;
  }

  await fs.writeFile(envPath, content, "utf-8");
};

async function handleGet() {
  const isInstalled = await checkJcodeInstalled();

  if (!isInstalled) {
    return {
      installed: false,
      message: "jcode not installed. Install via: curl -fsSL https://raw.githubusercontent.com/1jehuang/jcode/master/scripts/install.sh | bash",
    };
  }

  const config = await readConfig();
  const hasModelHub = hasModelHubConfig(config);

  return {
    installed: true,
    config,
    hasModelHub,
    configPath: getConfigPath(),
  };
}

async function handlePost(body: Record<string, unknown>) {
  const { baseUrl, apiKey, models } = body;

  if (!baseUrl || !apiKey) {
    throw new HttpValidationError("baseUrl and apiKey are required", 400);
  }

  const normalizedBaseUrl = String(baseUrl).endsWith("/v1")
    ? String(baseUrl)
    : `${baseUrl}/v1`;

  const config = await readConfig();

  if (!config.providers) {
    config.providers = {} as Record<string, Record<string, unknown>>;
  }

  (config.providers as Record<string, Record<string, unknown>>)["modelhub"] = {
    type: "openai-compatible",
    base_url: normalizedBaseUrl,
    auth: "bearer",
    api_key_env: "JCODE_MODELHUB_API_KEY",
    env_file: "provider-modelhub.env",
    default_model: Array.isArray(models) && models.length > 0 ? models[0] : "cc/claude-opus-4-7",
    requires_api_key: true,
  };

  const configDir = getJcodeConfigDir();
  await fs.mkdir(configDir, { recursive: true });

  await writeConfig(config);

  const xdgConfigDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const jcodeConfigDir = path.join(xdgConfigDir, "jcode");
  await fs.mkdir(jcodeConfigDir, { recursive: true });

  const env = await readProviderEnv();
  env.JCODE_MODELHUB_API_KEY = String(apiKey);
  await writeProviderEnv(env);

  return {
    success: true,
    message: "jcode configured successfully. Use: jcode --provider-profile modelhub",
    configPath: getConfigPath(),
  };
}

async function handleDelete() {
  const config = await readConfig();

  if (!config.providers) {
    return { success: true, message: "No configuration to remove" };
  }

  delete (config.providers as Record<string, unknown>)["modelhub"];

  await writeConfig(config);

  const env = await readProviderEnv();
  delete env.JCODE_MODELHUB_API_KEY;
  await writeProviderEnv(env);

  return {
    success: true,
    message: "modelhub configuration removed from jcode",
  };
}

export const { GET, POST, DELETE } = createCliToolHandlers("jcode", {
  get: handleGet,
  post: handlePost,
  delete: handleDelete,
});
