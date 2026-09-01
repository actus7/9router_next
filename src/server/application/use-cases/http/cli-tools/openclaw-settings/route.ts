import { NextRequest, NextResponse  } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

// OpenClaw 2026.5.x writes agents[].model as either a plain string
// (legacy) or as an object `{ primary, fallbacks }`. Normalize to the
// string id so downstream consumers can call `.startsWith()` safely.
const resolveAgentModel = (m: unknown): string => {
  if (typeof m === "string") return m;
  if (m && typeof m === "object") return (m as Record<string, unknown>).primary as string ?? "";
  return "";
};

const getOpenClawDir = () => path.join(os.homedir(), ".openclaw");
const getOpenClawSettingsPath = () => path.join(getOpenClawDir(), "openclaw.json");

// Check if openclaw CLI is installed (via which/where or config file exists)
const checkOpenClawInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where openclaw" : "which openclaw";
    // On Windows, inject %APPDATA%\npm into PATH so npm global packages are found
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getOpenClawSettingsPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Read current settings.json
const readSettings = async () => {
  try {
    const settingsPath = getOpenClawSettingsPath();
    const content = await fs.readFile(settingsPath, "utf-8");
    // Tolerate JSONC (trailing commas) and treat unparseable files as "no config"
    // rather than throwing a 500 that the UI misreads as "tool not installed".
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch  {
    return null;
  }
};

// Check if settings has ModelHub config
const hasModelHubConfig = (settings: Record<string, unknown> | null) => {
  if (!settings || !settings.models) return false;
  const models = settings.models as Record<string, unknown>;
  if (!models.providers) return false;
  return !!(models.providers as Record<string, unknown>)["modelhub"];
};

// Read per-agent models.json and return current model id (without "modelhub/" prefix)
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

// GET - Check openclaw CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkOpenClawInstalled();
    
    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        settings: null,
        message: "Open Claw CLI is not installed",
      });
    }

    const settings = await readSettings();

    // Enrich agents list with current per-agent model from models.json.
    // Coerce agent.model to its string id when OpenClaw stores it as
    // `{ primary, fallbacks }` so downstream `.startsWith()` calls work.
    const agentList = (settings?.agents as Record<string, unknown>)?.list || [];
    const enrichedAgents = await Promise.all(
      (agentList as Record<string, unknown>[]).map(async (agent: Record<string, unknown>) => {
        const agentModel = agent.agentDir ? await readAgentModel(agent.agentDir as string) : null;
        return { ...agent, model: resolveAgentModel(agent.model), currentModel: agentModel };
      })
    );

    return NextResponse.json({
      installed: true,
      settings,
      agents: enrichedAgents,
      hasModelHub: hasModelHubConfig(settings),
      settingsPath: getOpenClawSettingsPath(),
    });
  } catch (error) {
    console.error("Error checking openclaw settings:", error);
    return NextResponse.json({ error: "Failed to check openclaw settings" }, { status: 500 });
  }
}

// Write per-agent models.json
const writeAgentModels = async (agentDir: string, model: string, baseUrl: string, apiKey: string) => {
  await fs.mkdir(agentDir, { recursive: true });
  const modelsPath = path.join(agentDir, "models.json");
  let existing: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(modelsPath, "utf-8");
    existing = JSON.parse(content);
  } catch { /* No existing */ }

  if (!existing.providers) existing.providers = {};
  (existing.providers as Record<string, unknown>)["modelhub"] = {
    baseUrl,
    apiKey: apiKey || "your_api_key",
    api: "openai-completions",
    models: [{ id: model, name: model.split("/").pop() || model }],
  };
  await fs.writeFile(modelsPath, JSON.stringify(existing, null, 2));
};

// POST - Update ModelHub settings (merge with existing settings)
export async function POST(request: NextRequest) {
  try {
    // agentModels: { [agentId]: modelId } for per-agent override
    const { baseUrl, apiKey, model, agentModels = {} } = await request.json();
    
    if (!baseUrl || !model) {
      return NextResponse.json({ error: "baseUrl and model are required" }, { status: 400 });
    }

    const openclawDir = getOpenClawDir();
    const settingsPath = getOpenClawSettingsPath();

    await fs.mkdir(openclawDir, { recursive: true });

    let settings: Record<string, unknown> = {};
    try {
      const existingSettings = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(existingSettings);
    } catch { /* No existing settings */ }

    if (!settings.agents) settings.agents = {} as Record<string, unknown>;
    const agents = settings.agents as Record<string, unknown>;
    if (!agents.defaults) agents.defaults = {} as Record<string, unknown>;
    const defaults = agents.defaults as Record<string, unknown>;
    if (!defaults.model) defaults.model = {} as Record<string, unknown>;
    if (!defaults.models) defaults.models = {} as Record<string, unknown>;
    if (!settings.models) settings.models = {} as Record<string, unknown>;
    const models = settings.models as Record<string, unknown>;
    if (!models.providers) models.providers = {} as Record<string, unknown>;

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const fullModelId = `modelhub/${model}`;

    // Remove all old modelhub/* entries from agents.defaults.models
    Object.keys(defaults.models as Record<string, unknown>)
      .filter((k) => k.startsWith("modelhub/"))
      .forEach((k) => { delete (defaults.models as Record<string, unknown>)[k]; });

    // Update default model
    (defaults.model as Record<string, unknown>).primary = fullModelId;

    // Collect all unique models (default + per-agent)
    const allModelIds = new Set([model]);
    Object.values(agentModels as Record<string, unknown>).forEach((m) => { if (m) allModelIds.add(m as string); });

    // Add fresh modelhub models to allowlist
    allModelIds.forEach((m) => {
      (defaults.models as Record<string, unknown>)[`modelhub/${m}`] = {};
    });

    // Remove old modelhub model from each agent in agents.list. The
    // model field may be a plain string or `{ primary, fallbacks }`.
    if (agents.list) {
      agents.list = (agents.list as Record<string, unknown>[]).map((agent: Record<string, unknown>) => {
        if (resolveAgentModel(agent.model).startsWith("modelhub/")) {
          const { model: _, ...rest } = agent;
          return rest;
        }
        return agent;
      });
    }

    // Update models.providers.modelhub with all models
    (models.providers as Record<string, unknown>)["modelhub"] = {
      baseUrl: normalizedBaseUrl,
      apiKey: apiKey || "your_api_key",
      api: "openai-completions",
      models: [...allModelIds].map((m) => ({ id: m, name: m.split("/").pop() || m })),
    };

    // Set per-agent model in agents.list and write models.json
    if (agents.list) {
      agents.list = (agents.list as Record<string, unknown>[]).map((agent: Record<string, unknown>) => {
        const agentModel = (agentModels as Record<string, unknown>)[agent.id as string];
        if (agentModel) return { ...agent, model: `modelhub/${agentModel}` };
        return agent;
      });

      // Write per-agent models.json for agents with agentDir
      await Promise.all(
        (agents.list as Record<string, unknown>[]).map(async (agent: Record<string, unknown>) => {
          if (!agent.agentDir) return;
          const agentModel = (agentModels as Record<string, unknown>)[agent.id as string];
          const modelToWrite = (agentModel as string) || model; // fallback to default
          await writeAgentModels(agent.agentDir as string, modelToWrite, normalizedBaseUrl, apiKey);
        })
      );
    }

    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    return NextResponse.json({
      success: true,
      message: "Open Claw settings applied successfully!",
      settingsPath,
    });
  } catch (error) {
    console.error("Error updating openclaw settings:", error);
    return NextResponse.json({ error: "Failed to update openclaw settings" }, { status: 500 });
  }
}

// DELETE - Remove ModelHub settings only (keep other settings)
export async function DELETE() {
  try {
    const settingsPath = getOpenClawSettingsPath();

    // Read existing settings
    let settings: Record<string, unknown> = {};
    try {
      const existingSettings = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(existingSettings);
    } catch (error: unknown) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No settings file to reset",
        });
      }
      throw error;
    }

    // Remove ModelHub from models.providers
    const delModels = settings.models as Record<string, unknown> | undefined;
    if (delModels && delModels.providers) {
      delete (delModels.providers as Record<string, unknown>)["modelhub"];
      
      // Remove providers object if empty
      if (Object.keys(delModels.providers as Record<string, unknown>).length === 0) {
        delete delModels.providers;
      }
    }

    // Remove modelhub models from agents.defaults.models allowlist
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

    // Reset agents.defaults.model.primary if it uses modelhub
    const delDefModel = delDefaults?.model as Record<string, unknown> | undefined;
    if (typeof delDefModel?.primary === "string" && delDefModel.primary.startsWith("modelhub/")) {
      delete delDefModel.primary;
    }

    // Write updated settings
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    return NextResponse.json({
      success: true,
      message: "ModelHub settings removed successfully",
    });
  } catch (error) {
    console.error("Error resetting openclaw settings:", error);
    return NextResponse.json({ error: "Failed to reset openclaw settings" }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
