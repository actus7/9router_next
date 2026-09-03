import fs from "fs/promises";
import path from "path";
import os from "os";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { readJsonFile } from "@/server/application/use-cases/http/cli-tools/cliToolIo";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";

const getConfigPath = () => {
  const home = os.homedir();
  const platform = os.platform();
  if (platform === "win32") {
    return path.join(process.env.APPDATA || home, "Code", "User", "chatLanguageModels.json");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Code", "User", "chatLanguageModels.json");
  }
  return path.join(home, ".config", "Code", "User", "chatLanguageModels.json");
};

const hasModelHubConfig = (config: unknown) => {
  if (!Array.isArray(config)) return false;
  return config.some((entry: Record<string, unknown>) => entry.name === "ModelHub");
};

const getModelHubEntry = (config: unknown) => {
  if (!Array.isArray(config)) return null;
  return (config as Record<string, unknown>[]).find((entry) => entry.name === "ModelHub") || null;
};

async function handleGet() {
  const config = await readJsonFile(getConfigPath());
  const entry = getModelHubEntry(config);

  return {
    installed: true,
    config,
    hasModelHub: hasModelHubConfig(config),
    configPath: getConfigPath(),
    currentModel: (entry?.models as Record<string, unknown>[])?.[0]?.id || null,
    currentUrl: (entry?.models as Record<string, unknown>[])?.[0]?.url || null,
  };
}

async function handlePost(body: Record<string, unknown>) {
  const { baseUrl, apiKey, models } = body;
  if (!baseUrl || !Array.isArray(models) || models.length === 0) {
    throw new HttpValidationError("baseUrl and models are required", 400);
  }

  const configPath = getConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  let config: Array<Record<string, unknown>> = [];
  try {
    const existing = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(existing);
    config = Array.isArray(parsed) ? parsed : [];
  } catch { /* No existing config */ }

  const endpointUrl = `${baseUrl}/chat/completions#models.ai.azure.com`;
  const keyToUse = typeof apiKey === "string" && apiKey ? apiKey : "sk_modelhub";

  const newEntry = {
    name: "ModelHub",
    vendor: "azure",
    apiKey: keyToUse,
    models: (models as string[]).map((id) => ({
      id,
      name: id,
      url: endpointUrl,
      toolCalling: true,
      vision: false,
      maxInputTokens: 128000,
      maxOutputTokens: 16000,
    })),
  };

  const idx = config.findIndex((e) => e.name === "ModelHub");
  if (idx >= 0) {
    config[idx] = newEntry;
  } else {
    config.push(newEntry);
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  return {
    success: true,
    message: "Copilot settings applied! Reload VS Code to take effect.",
    configPath,
  };
}

async function handleDelete() {
  const configPath = getConfigPath();

  let config: Array<Record<string, unknown>> = [];
  try {
    const existing = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(existing);
    config = Array.isArray(parsed) ? parsed : [];
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: true, message: "No config file to reset" };
    }
    throw error;
  }

  config = config.filter((e) => e.name !== "ModelHub");
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  return {
    success: true,
    message: "ModelHub removed from Copilot config",
  };
}

export const { GET, POST, DELETE } = createCliToolHandlers("copilot", {
  get: handleGet,
  post: handlePost,
  delete: handleDelete,
});
