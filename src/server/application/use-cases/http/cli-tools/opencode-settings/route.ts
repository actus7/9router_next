import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { checkCliOnPath, readJsonFile } from "@/server/application/use-cases/http/cli-tools/cliToolIo";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";

const getConfigDir = () => path.join(os.homedir(), ".config", "opencode");
const getConfigPath = () => path.join(getConfigDir(), "opencode.json");

const hasModelHubConfig = (config: Record<string, unknown>) => {
  if (!config?.provider) return false;
  return !!(config.provider as Record<string, unknown>)["modelhub"];
};

async function handleGet() {
  const isInstalled = await checkCliOnPath("opencode", getConfigPath());

  if (!isInstalled) {
    return {
      installed: false,
      config: null,
      message: "OpenCode CLI is not installed",
    };
  }

  const config = await readJsonFile<Record<string, unknown>>(getConfigPath());
  const providerConfig = (config?.provider as Record<string, unknown> | undefined)?.["modelhub"] as Record<string, unknown> | undefined;
  const modelMap = (providerConfig?.models as Record<string, unknown>) || {};

  return {
    installed: true,
    config,
    hasModelHub: config ? hasModelHubConfig(config) : false,
    configPath: getConfigPath(),
    opencode: {
      models: Object.keys(modelMap),
      activeModel: typeof config?.model === "string" && config.model.startsWith("modelhub/")
        ? config.model.replace(/^modelhub\//, "")
        : null,
      baseURL: (providerConfig?.options as Record<string, unknown> | undefined)?.baseURL || null,
    },
  };
}

async function handlePost(body: Record<string, unknown>) {
  const { baseUrl, apiKey, model, models, activeModel, subagentModel } = body;

  const modelsArray = Array.isArray(models) ? models.slice() : (typeof model === "string" ? [model] : []);

  if (!baseUrl || modelsArray.length === 0) {
    throw new HttpValidationError("baseUrl and at least one model are required", 400);
  }

  const configDir = getConfigDir();
  const configPath = getConfigPath();

  await fs.mkdir(configDir, { recursive: true });

  const config: Record<string, unknown> = (await readJsonFile<Record<string, unknown>>(configPath)) || {};

  const normalizedBaseUrl = String(baseUrl).endsWith("/v1") ? String(baseUrl) : `${baseUrl}/v1`;
  const keyToUse = apiKey || "sk_modelhub";
  const effectiveSubagentModel = subagentModel || modelsArray[0];

  if (!config.provider) config.provider = {};

  const providerObj = config.provider as Record<string, unknown>;
  const existingProvider = (providerObj["modelhub"] as Record<string, unknown>) || {
    npm: "@ai-sdk/openai-compatible",
    options: {},
    models: {},
  };

  existingProvider.options = {
    ...((existingProvider.options as Record<string, unknown>) || {}),
    baseURL: normalizedBaseUrl,
    apiKey: keyToUse,
  };

  if (!(existingProvider as Record<string, unknown>).models) {
    (existingProvider as Record<string, unknown>).models = {};
  }

  for (const m of modelsArray) {
    if (!m || typeof m !== "string") continue;
    (existingProvider.models as Record<string, unknown>)[m] = {
      name: m,
      modalities: { input: ["text", "image"], output: ["text"] },
    };
  }

  providerObj["modelhub"] = existingProvider;

  if (activeModel === "") {
    config.model = "";
  } else {
    const finalActive = activeModel || modelsArray[0];
    if (finalActive) {
      config.model = `modelhub/${finalActive}`;
    }
  }

  if (!config.agent) config.agent = {};
  (config.agent as Record<string, unknown>).explorer = {
    description: "Fast explorer subagent for codebase exploration",
    mode: "subagent",
    model: `modelhub/${effectiveSubagentModel}`,
  };

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  return {
    success: true,
    message: "OpenCode settings applied successfully!",
    configPath,
  };
}

async function handlePatch(body: Record<string, unknown>) {
  const { clearActiveModel } = body;
  const configPath = getConfigPath();

  const config = await readJsonFile<Record<string, unknown>>(configPath);
  if (!config) {
    return { success: true, message: "No config file found" };
  }

  if (clearActiveModel === true && typeof config.model === "string" && config.model.startsWith("modelhub/")) {
    config.model = "";
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  return {
    success: true,
    message: "Settings updated",
  };
}

async function handleDelete(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const modelToRemove = searchParams.get("model");
  const configPath = getConfigPath();

  const config = await readJsonFile<Record<string, unknown>>(configPath);
  if (!config) {
    return { success: true, message: "No config file to reset" };
  }

  const providerObj = config.provider as Record<string, unknown> | undefined;
  const router9 = providerObj?.["modelhub"] as Record<string, unknown> | undefined;

  if (modelToRemove && router9?.models) {
    delete (router9.models as Record<string, unknown>)[modelToRemove];

    if (Object.keys(router9.models as Record<string, unknown>).length === 0) {
      delete providerObj!["modelhub"];
      if (typeof config.model === "string" && config.model.startsWith("modelhub/")) delete config.model;
    } else if (config.model === `modelhub/${modelToRemove}`) {
      const remainingModels = Object.keys(router9.models as Record<string, unknown>);
      config.model = `modelhub/${remainingModels[0]}`;
    }
  } else {
    if (providerObj) delete providerObj["modelhub"];
    if (typeof config.model === "string" && config.model.startsWith("modelhub/")) delete config.model;
  }

  const agentObj = config.agent as Record<string, unknown> | undefined;
  const explorerObj = agentObj?.explorer as Record<string, unknown> | undefined;
  if (typeof explorerObj?.model === "string" && explorerObj.model.startsWith("modelhub/")) {
    delete agentObj!.explorer;
    if (Object.keys(agentObj!).length === 0) delete config.agent;
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  return {
    success: true,
    message: modelToRemove ? `Model "${modelToRemove}" removed` : "ModelHub settings removed from OpenCode",
  };
}

export const { GET, POST, PATCH, DELETE } = createCliToolHandlers("opencode", {
  get: handleGet,
  post: handlePost,
  patch: handlePatch,
  delete: handleDelete,
});
