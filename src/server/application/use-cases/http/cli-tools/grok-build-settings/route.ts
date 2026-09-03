import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";
import { getCapabilitiesForModel } from "@/server/llm-gateway/catalog";
import {
  applyGrokBuildConfig,
  GROK_SUBAGENT_TYPES,
  parseGrokBuildConfig,
  resetGrokBuildConfig,
} from "@/lib/grokBuildConfig";

const execAsync = promisify(exec);

const getGrokDir = () => path.join(os.homedir(), ".grok");
const getGrokConfigPath = () => path.join(getGrokDir(), "config.toml");
const getGrokBinPath = () => path.join(getGrokDir(), "bin", "grok");

const checkGrokInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    await execAsync(isWindows ? "where grok" : "which grok", { windowsHide: true });
    return true;
  } catch {
    for (const candidate of [getGrokBinPath(), getGrokConfigPath()]) {
      try {
        await fs.access(candidate);
        return true;
      } catch { /* try next */ }
    }
    return false;
  }
};

const readConfigToml = async () => {
  try {
    return await fs.readFile(getGrokConfigPath(), "utf-8");
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
};

const normalizeContextWindow = (value: unknown, model: string) => {
  const explicit = Number(value);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const slash = model.indexOf("/");
  const provider = slash > 0 ? model.slice(0, slash) : "";
  const modelId = slash > 0 ? model.slice(slash + 1) : model;
  return getCapabilitiesForModel(provider, modelId).contextWindow;
};

const normalizeSubagentModels = (value: unknown) => {
  if (value === undefined) return undefined; // backwards-compatible callers leave current overrides untouched
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, { model: string; contextWindow: number }> = {};
  for (const type of GROK_SUBAGENT_TYPES) {
    const entry = (value as Record<string, unknown>)[type];
    const entryObj = entry && typeof entry === "object" ? entry as Record<string, unknown> : undefined;
    const model = typeof entry === "string" ? entry.trim() : (entryObj?.model as string | undefined)?.trim();
    if (!model) continue; // blank means inherit the main model
    result[type] = {
      model,
      contextWindow: normalizeContextWindow(entryObj?.contextWindow, model),
    };
  }
  return result;
};

const hasModelHubConfig = (settings: Record<string, unknown> | null | undefined) => Boolean((settings?.model as Record<string, unknown>)?.base_url);

async function handleGet() {
  const installed = await checkGrokInstalled();
  if (!installed) {
    return {
      installed: false,
      settings: null,
      message: "Grok Build is not installed",
    };
  }

  const settings = parseGrokBuildConfig(await readConfigToml());
  return {
    installed: true,
    settings,
    hasModelHub: hasModelHubConfig(settings as unknown as Record<string, unknown>),
    configPath: getGrokConfigPath(),
  };
}

async function handlePost(body: Record<string, unknown>) {
  const { baseUrl, apiKey, model, contextWindow, subagentModels } = body;
  const selectedModel = typeof model === "string" ? model.trim() : "";
  if (!baseUrl || !selectedModel) {
    throw new HttpValidationError("baseUrl and model are required", 400);
  }

  await fs.mkdir(getGrokDir(), { recursive: true });
  const normalizedBaseUrl = String(baseUrl).endsWith("/v1") ? String(baseUrl) : `${baseUrl}/v1`;
  const toml = applyGrokBuildConfig(await readConfigToml(), {
    baseUrl: normalizedBaseUrl,
    apiKey: typeof apiKey === "string" && apiKey ? apiKey : "sk_modelhub",
    model: selectedModel,
    contextWindow: normalizeContextWindow(contextWindow, selectedModel),
    subagentModels: normalizeSubagentModels(subagentModels),
  });
  await fs.writeFile(getGrokConfigPath(), toml);

  return {
    success: true,
    message: "Grok Build settings applied successfully!",
    configPath: getGrokConfigPath(),
    modelSlot: "modelhub",
  };
}

async function handleDelete() {
  const configPath = getGrokConfigPath();
  let toml;
  try {
    toml = await fs.readFile(configPath, "utf-8");
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: true, message: "No config file to reset" };
    }
    throw error;
  }

  await fs.writeFile(configPath, resetGrokBuildConfig(toml));
  return {
    success: true,
    message: "modelhub model slots removed from Grok Build",
  };
}

export const { GET, POST, DELETE } = createCliToolHandlers("grok-build", {
  get: handleGet,
  post: handlePost,
  delete: handleDelete,
});
