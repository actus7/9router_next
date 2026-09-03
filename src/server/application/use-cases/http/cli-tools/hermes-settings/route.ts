import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";

const execAsync = promisify(exec);

const API_KEY_ENV = "OPENAI_API_KEY";
const getHermesDir = () => path.join(os.homedir(), ".hermes");
const getHermesConfigPath = () => path.join(getHermesDir(), "config.yaml");
const getHermesEnvPath = () => path.join(getHermesDir(), ".env");

const MODEL_BLOCK_RE = /^model:[ \t]*\r?\n((?:[ \t]+.*\r?\n?|[ \t]*\r?\n)*)/m;

const buildModelBlock = (model: string, baseUrl: string) =>
  `model:\n  default: "${model}"\n  provider: "custom"\n  base_url: "${baseUrl}"\n  api_key: \${OPENAI_API_KEY}\n`;

const parseModelBlock = (yaml: string) => {
  const match = yaml.match(MODEL_BLOCK_RE);
  if (!match) return null;
  const body = match[1] || "";
  const get = (key: string) => {
    const m = body.match(new RegExp(`^[ \\t]+${key}:[ \\t]*["']?([^"'\\r\\n]+)["']?`, "m"));
    return m ? m[1].trim() : null;
  };
  return {
    default: get("default"),
    provider: get("provider"),
    base_url: get("base_url"),
    api_key: get("api_key"),
  };
};

const upsertModelBlock = (yaml: string, newBlock: string) => {
  if (MODEL_BLOCK_RE.test(yaml)) return yaml.replace(MODEL_BLOCK_RE, newBlock);
  return yaml.length > 0 ? `${newBlock}\n${yaml}` : newBlock;
};

const removeModelBlock = (yaml: string) => yaml.replace(MODEL_BLOCK_RE, "").replace(/^\n+/, "");

const upsertEnvVar = (envText: string, key: string, value: string) => {
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (re.test(envText)) return envText.replace(re, line);
  return envText.length > 0 && !envText.endsWith("\n") ? `${envText}\n${line}\n` : `${envText}${line}\n`;
};

const checkHermesInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    await execAsync(isWindows ? "where hermes" : "which hermes", { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getHermesConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readConfigYaml = async () => {
  try {
    return await fs.readFile(getHermesConfigPath(), "utf-8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
};

const readEnvFile = async () => {
  try {
    return await fs.readFile(getHermesEnvPath(), "utf-8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
};

const hasModelHubConfig = (modelCfg: Record<string, unknown> | null) => {
  if (!modelCfg?.base_url) return false;
  return modelCfg.provider === "custom" && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(modelCfg.base_url as string);
};

async function handleGet() {
  const installed = await checkHermesInstalled();
  if (!installed) {
    return { installed: false, settings: null, message: "Hermes Agent is not installed" };
  }
  const yaml = await readConfigYaml();
  const model = parseModelBlock(yaml);
  return {
    installed: true,
    settings: { model },
    hasModelHub: hasModelHubConfig(model),
    configPath: getHermesConfigPath(),
  };
}

async function handlePost(body: Record<string, unknown>) {
  const { baseUrl, apiKey, model } = body;
  if (!baseUrl || !model) {
    throw new HttpValidationError("baseUrl and model are required", 400);
  }

  await fs.mkdir(getHermesDir(), { recursive: true });
  const normalizedBaseUrl = String(baseUrl).endsWith("/v1") ? String(baseUrl) : `${baseUrl}/v1`;
  const existingYaml = await readConfigYaml();
  const newYaml = upsertModelBlock(existingYaml, buildModelBlock(String(model), normalizedBaseUrl));
  await fs.writeFile(getHermesConfigPath(), newYaml);

  if (typeof apiKey === "string" && apiKey) {
    const existingEnv = await readEnvFile();
    const newEnv = upsertEnvVar(existingEnv, API_KEY_ENV, apiKey);
    await fs.writeFile(getHermesEnvPath(), newEnv);
  }

  return {
    success: true,
    message: "Hermes settings applied successfully!",
    configPath: getHermesConfigPath(),
  };
}

async function handleDelete() {
  const configPath = getHermesConfigPath();
  let yaml = "";
  try {
    yaml = await fs.readFile(configPath, "utf-8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: true, message: "No config file to reset" };
    }
    throw error;
  }
  const newYaml = removeModelBlock(yaml);
  await fs.writeFile(configPath, newYaml);
  return { success: true, message: "modelhub model block removed" };
}

export const { GET, POST, DELETE } = createCliToolHandlers("hermes", {
  get: handleGet,
  post: handlePost,
  delete: handleDelete,
});
