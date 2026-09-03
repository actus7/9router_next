import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseTOML, stringifyTOML } from "confbox";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";
import { checkCliOnPath } from "@/server/application/use-cases/http/cli-tools/cliToolIo";

const getCodexDir = () => path.join(os.homedir(), ".codex");
const getCodexConfigPath = () => path.join(getCodexDir(), "config.toml");
const getCodexAuthPath = () => path.join(getCodexDir(), "auth.json");

// Flatten confbox-parsed TOML into a writable object, preserving nested tables
const parsedToWritable = (obj: unknown): Record<string, unknown> => (obj as Record<string, unknown>) ?? {};

// Set a nested key from a flat dotted path, creating intermediate objects as needed
const setNestedSection = (obj: Record<string, unknown>, dottedKey: string, value: unknown) => {
  const keys = dottedKey.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== "object") {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
};

// Delete a nested key from a flat dotted path
const deleteNestedSection = (obj: Record<string, unknown>, dottedKey: string) => {
  const keys = dottedKey.split(".");
  let cur: Record<string, unknown> | undefined = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur?.[keys[i]] as Record<string, unknown> | undefined;
    if (cur == null) return;
  }
  delete cur[keys[keys.length - 1]];
};

// Check if codex CLI is installed (via which/where or config file exists)
const checkCodexInstalled = async () => checkCliOnPath("codex", getCodexConfigPath());

// Read current config.toml
const readConfig = async () => {
  try {
    const configPath = getCodexConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    return content;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

// Check if config has ModelHub settings
const hasModelHubConfig = (config: string | null) => {
  if (!config) return false;
  return config.includes("model_provider = \"modelhub\"") || config.includes("[model_providers.modelhub]");
};

async function handleGet() {
  const isInstalled = await checkCodexInstalled();

  if (!isInstalled) {
    return {
      installed: false,
      config: null,
      message: "Codex CLI is not installed",
    };
  }

  const config = await readConfig();

  return {
    installed: true,
    config,
    hasModelHub: hasModelHubConfig(config),
    configPath: getCodexConfigPath(),
  };
}

async function handlePost(body: Record<string, unknown>) {
  const { baseUrl, apiKey, model, subagentModel } = body;

  if (!baseUrl || !apiKey || !model) {
    throw new HttpValidationError("baseUrl, apiKey and model are required", 400);
  }

  const codexDir = getCodexDir();
  const configPath = getCodexConfigPath();

  await fs.mkdir(codexDir, { recursive: true });

  let parsed: Record<string, unknown> = {};
  try {
    const existingConfig = await fs.readFile(configPath, "utf-8");
    parsed = parsedToWritable(parseTOML(existingConfig));
  } catch { /* No existing config */ }

  parsed.model = model;
  parsed.model_provider = "modelhub";

  const normalizedBaseUrl = String(baseUrl).endsWith("/v1") ? String(baseUrl) : `${baseUrl}/v1`;
  setNestedSection(parsed, "model_providers.modelhub", {
    name: "ModelHub",
    base_url: normalizedBaseUrl,
    wire_api: "responses",
  });

  const effectiveSubagentModel = subagentModel || model;
  setNestedSection(parsed, "agents.subagent", {
    model: effectiveSubagentModel,
  });

  const configContent = stringifyTOML(parsed);
  await fs.writeFile(configPath, configContent);

  const authPath = getCodexAuthPath();
  let authData: Record<string, unknown> = {};
  try {
    const existingAuth = await fs.readFile(authPath, "utf-8");
    authData = JSON.parse(existingAuth);
  } catch { /* No existing auth */ }

  authData.OPENAI_API_KEY = apiKey;
  authData.auth_mode = "apikey";
  await fs.writeFile(authPath, JSON.stringify(authData, null, 2));

  return {
    success: true,
    message: "Codex settings applied successfully!",
    configPath,
  };
}

async function handleDelete() {
  const configPath = getCodexConfigPath();

  let parsed: Record<string, unknown> = {};
  try {
    const existingConfig = await fs.readFile(configPath, "utf-8");
    parsed = parsedToWritable(parseTOML(existingConfig));
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        success: true,
        message: "No config file to reset",
      };
    }
    throw error;
  }

  if (parsed.model_provider === "modelhub") {
    delete parsed.model;
    delete parsed.model_provider;
  }

  deleteNestedSection(parsed, "model_providers.modelhub");
  deleteNestedSection(parsed, "agents.subagent");

  const configContent = stringifyTOML(parsed);
  await fs.writeFile(configPath, configContent);

  const authPath = getCodexAuthPath();
  try {
    const existingAuth = await fs.readFile(authPath, "utf-8");
    const authData = JSON.parse(existingAuth);
    delete authData.OPENAI_API_KEY;
    delete authData.auth_mode;

    if (Object.keys(authData).length === 0) {
      await fs.unlink(authPath);
    } else {
      await fs.writeFile(authPath, JSON.stringify(authData, null, 2));
    }
  } catch { /* No auth file */ }

  return {
    success: true,
    message: "ModelHub settings removed successfully",
  };
}

export const { GET, POST, DELETE } = createCliToolHandlers("codex", {
  get: handleGet,
  post: handlePost,
  delete: handleDelete,
});
