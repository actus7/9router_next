import fs from "fs/promises";
import path from "path";
import os from "os";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { checkCliOnPath, readJsonFile } from "@/server/application/use-cases/http/cli-tools/cliToolIo";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";

const resolveAgentModel = (m: unknown): string => {
  if (typeof m === "string") return m;
  if (m && typeof m === "object") return (m as Record<string, unknown>).primary as string ?? "";
  return "";
};

const getOpenClawDir = () => path.join(os.homedir(), ".openclaw");
const getOpenClawSettingsPath = () => path.join(getOpenClawDir(), "openclaw.json");

const hasModelHubConfig = (settings: Record<string, unknown> | null) => {
  if (!settings || !settings.models) return false;
  const models = settings.models as Record<string, unknown>;
  if (!models.providers) return false;
  return !!(models.providers as Record<string, unknown>)["modelhub"];
};

const readAgentModel = async (agentDir: string) => {
  try {
    const modelsPath = path.join(agentDir, "models.json");
    const content = await fs.readFile(modelsPath, "utf-8");
    const data = JSON.parse(content);
    const models = data?.providers?.["modelhub"]?.models;
    return models?.[0]?.id || null;
  } catch {
    return null;
  }
};

const writeAgentModels = async (agentDir: string, model: string, baseUrl: string, apiKey: string) => {
  await fs.mkdir(agentDir, { recursive: true });
  const modelsPath = path.join(agentDir, "models.json");
  const existing = (await readJsonFile<Record<string, unknown>>(modelsPath)) || {};

  if (!existing.providers) existing.providers = {};
  (existing.providers as Record<string, unknown>)["modelhub"] = {
    baseUrl,
    apiKey: apiKey || "your_api_key",
    api: "openai-completions",
    models: [{ id: model, name: model.split("/").pop() || model }],
  };
  await fs.writeFile(modelsPath, JSON.stringify(existing, null, 2));
};

async function handleGet() {
  const isInstalled = await checkCliOnPath("openclaw", getOpenClawSettingsPath());

  if (!isInstalled) {
    return {
      installed: false,
      settings: null,
      message: "Open Claw CLI is not installed",
    };
  }

  const settings = await readJsonFile<Record<string, unknown>>(getOpenClawSettingsPath());

  const agentList = (settings?.agents as Record<string, unknown> | undefined)?.list || [];
  const enrichedAgents = await Promise.all(
    (agentList as Record<string, unknown>[]).map(async (agent: Record<string, unknown>) => {
      const agentModel = agent.agentDir ? await readAgentModel(agent.agentDir as string) : null;
      return { ...agent, model: resolveAgentModel(agent.model), currentModel: agentModel };
    }),
  );

  return {
    installed: true,
    settings,
    agents: enrichedAgents,
    hasModelHub: hasModelHubConfig(settings),
    settingsPath: getOpenClawSettingsPath(),
  };
}

async function handlePost(body: Record<string, unknown>) {
  const { baseUrl, apiKey, model, agentModels = {} } = body;

  if (!baseUrl || !model) {
    throw new HttpValidationError("baseUrl and model are required", 400);
  }

  const openclawDir = getOpenClawDir();
  const settingsPath = getOpenClawSettingsPath();

  await fs.mkdir(openclawDir, { recursive: true });

  const settings: Record<string, unknown> = (await readJsonFile<Record<string, unknown>>(settingsPath)) || {};

  if (!settings.agents) settings.agents = {} as Record<string, unknown>;
  const agents = settings.agents as Record<string, unknown>;
  if (!agents.defaults) agents.defaults = {} as Record<string, unknown>;
  const defaults = agents.defaults as Record<string, unknown>;
  if (!defaults.model) defaults.model = {} as Record<string, unknown>;
  if (!defaults.models) defaults.models = {} as Record<string, unknown>;
  if (!settings.models) settings.models = {} as Record<string, unknown>;
  const models = settings.models as Record<string, unknown>;
  if (!models.providers) models.providers = {} as Record<string, unknown>;

  const normalizedBaseUrl = String(baseUrl).endsWith("/v1") ? String(baseUrl) : `${baseUrl}/v1`;
  const fullModelId = `modelhub/${model}`;

  Object.keys(defaults.models as Record<string, unknown>)
    .filter((k) => k.startsWith("modelhub/"))
    .forEach((k) => { delete (defaults.models as Record<string, unknown>)[k]; });

  (defaults.model as Record<string, unknown>).primary = fullModelId;

  const allModelIds = new Set([String(model)]);
  Object.values(agentModels as Record<string, unknown>).forEach((m) => { if (m) allModelIds.add(m as string); });

  allModelIds.forEach((m) => {
    (defaults.models as Record<string, unknown>)[`modelhub/${m}`] = {};
  });

  if (agents.list) {
    agents.list = (agents.list as Record<string, unknown>[]).map((agent: Record<string, unknown>) => {
      if (resolveAgentModel(agent.model).startsWith("modelhub/")) {
        const { model: _, ...rest } = agent;
        return rest;
      }
      return agent;
    });
  }

  (models.providers as Record<string, unknown>)["modelhub"] = {
    baseUrl: normalizedBaseUrl,
    apiKey: apiKey || "your_api_key",
    api: "openai-completions",
    models: [...allModelIds].map((m) => ({ id: m, name: m.split("/").pop() || m })),
  };

  if (agents.list) {
    agents.list = (agents.list as Record<string, unknown>[]).map((agent: Record<string, unknown>) => {
      const agentModel = (agentModels as Record<string, unknown>)[agent.id as string];
      if (agentModel) return { ...agent, model: `modelhub/${agentModel}` };
      return agent;
    });

    await Promise.all(
      (agents.list as Record<string, unknown>[]).map(async (agent: Record<string, unknown>) => {
        if (!agent.agentDir) return;
        const agentModel = (agentModels as Record<string, unknown>)[agent.id as string];
        const modelToWrite = (agentModel as string) || String(model);
        await writeAgentModels(agent.agentDir as string, modelToWrite, normalizedBaseUrl, String(apiKey || ""));
      }),
    );
  }

  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

  return {
    success: true,
    message: "Open Claw settings applied successfully!",
    settingsPath,
  };
}

async function handleDelete() {
  const settingsPath = getOpenClawSettingsPath();

  const settings = await readJsonFile<Record<string, unknown>>(settingsPath);
  if (!settings) {
    return {
      success: true,
      message: "No settings file to reset",
    };
  }

  const delModels = settings.models as Record<string, unknown> | undefined;
  if (delModels && delModels.providers) {
    delete (delModels.providers as Record<string, unknown>)["modelhub"];

    if (Object.keys(delModels.providers as Record<string, unknown>).length === 0) {
      delete delModels.providers;
    }
  }

  const delAgents = settings.agents as Record<string, unknown> | undefined;
  const delDefaults = delAgents?.defaults as Record<string, unknown> | undefined;
  const delDefModels = delDefaults?.models as Record<string, unknown> | undefined;
  if (delDefModels) {
    const keysToRemove = Object.keys(delDefModels).filter((k) => k.startsWith("modelhub/"));
    for (const key of keysToRemove) {
      delete delDefModels[key];
    }
    if (Object.keys(delDefModels).length === 0) {
      delete delDefaults!.models;
    }
  }

  const delDefModel = delDefaults?.model as Record<string, unknown> | undefined;
  if (typeof delDefModel?.primary === "string" && delDefModel.primary.startsWith("modelhub/")) {
    delete delDefModel.primary;
  }

  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

  return {
    success: true,
    message: "ModelHub settings removed successfully",
  };
}

export const { GET, POST, DELETE } = createCliToolHandlers("openclaw", {
  get: handleGet,
  post: handlePost,
  delete: handleDelete,
});
