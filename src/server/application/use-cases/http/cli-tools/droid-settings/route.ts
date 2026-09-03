import type { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { checkCliOnPath, readJsonFile } from "@/server/application/use-cases/http/cli-tools/cliToolIo";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";

const getDroidDir = () => path.join(os.homedir(), ".factory");
const getDroidSettingsPath = () => path.join(getDroidDir(), "settings.json");

const hasModelHubConfig = (settings: Record<string, unknown> | null) => {
  if (!settings || !settings.customModels) return false;
  return (settings.customModels as Array<Record<string, unknown>>).some((m) => (m.id as string)?.startsWith("custom:ModelHub"));
};

async function handleGet(_request: NextRequest) {
  const isInstalled = await checkCliOnPath("droid", getDroidSettingsPath());

  if (!isInstalled) {
    return {
      installed: false,
      settings: null,
      message: "Factory Droid CLI is not installed",
    };
  }

  const settings = await readJsonFile(getDroidSettingsPath());
  return {
    installed: true,
    settings,
    hasModelHub: hasModelHubConfig(settings),
    settingsPath: getDroidSettingsPath(),
  };
}

async function handlePost(body: Record<string, unknown>, _request: NextRequest) {
  const { baseUrl, apiKey, model, models, activeModel } = body;
  const modelsArray = Array.isArray(models) ? models.slice() : (typeof model === "string" ? [model] : []);

  if (!baseUrl || modelsArray.length === 0) {
    throw new HttpValidationError("baseUrl and at least one model are required", 400);
  }

  const droidDir = getDroidDir();
  const settingsPath = getDroidSettingsPath();
  await fs.mkdir(droidDir, { recursive: true });

  let settings: Record<string, unknown> = {};
  try {
    const existingSettings = await fs.readFile(settingsPath, "utf-8");
    settings = JSON.parse(existingSettings);
  } catch { /* No existing settings */ }

  if (!settings.customModels) {
    settings.customModels = [];
  }

  settings.customModels = (settings.customModels as Array<Record<string, unknown>>).filter((m) => !(m.id as string)?.startsWith("custom:ModelHub"));

  const normalizedBaseUrl = String(baseUrl).endsWith("/v1") ? String(baseUrl) : `${baseUrl}/v1`;
  const keyToUse = typeof apiKey === "string" && apiKey ? apiKey : "your_api_key";

  let defaultIndex = 0;
  if (typeof activeModel === "string") {
    if (activeModel === "") {
      defaultIndex = -1;
    } else {
      const idx = modelsArray.indexOf(activeModel);
      defaultIndex = idx >= 0 ? idx : 0;
    }
  }

  const customModels = settings.customModels as Array<Record<string, unknown>>;
  for (let i = 0; i < modelsArray.length; i++) {
    const m = modelsArray[i];
    if (!m || typeof m !== "string") continue;
    customModels.push({
      model: m,
      id: `custom:ModelHub-${i}`,
      index: i,
      baseUrl: normalizedBaseUrl,
      apiKey: keyToUse,
      displayName: m,
      maxOutputTokens: 131072,
      noImageSupport: false,
      provider: "openai",
    });
  }

  if (defaultIndex >= 0 && customModels[defaultIndex]) {
    const [defaultEntry] = customModels.splice(defaultIndex, 1);
    customModels.unshift({ ...defaultEntry, index: 0 });
    customModels.forEach((entry, i) => { entry.index = i; });
  }

  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

  return {
    success: true,
    message: "Factory Droid settings applied successfully!",
    settingsPath,
  };
}

async function handleDelete(_request: NextRequest) {
  const settingsPath = getDroidSettingsPath();

  let settings: Record<string, unknown> = {};
  try {
    const existingSettings = await fs.readFile(settingsPath, "utf-8");
    settings = JSON.parse(existingSettings);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: true, message: "No settings file to reset" };
    }
    throw error;
  }

  if (settings.customModels) {
    settings.customModels = (settings.customModels as Array<Record<string, unknown>>).filter((m) => !(m.id as string)?.startsWith("custom:ModelHub"));
    if ((settings.customModels as Array<unknown>).length === 0) {
      delete settings.customModels;
    }
  }

  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

  return {
    success: true,
    message: "ModelHub settings removed successfully",
  };
}

export const { GET, POST, DELETE } = createCliToolHandlers("droid", {
  get: handleGet,
  post: handlePost,
  delete: handleDelete,
});
