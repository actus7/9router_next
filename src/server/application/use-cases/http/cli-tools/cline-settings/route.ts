import fs from "fs/promises";
import path from "path";
import os from "os";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { checkCliOnPath, readJsonFile } from "@/server/application/use-cases/http/cli-tools/cliToolIo";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";

const getDataDir = () => path.join(os.homedir(), ".cline", "data");
const getGlobalStatePath = () => path.join(getDataDir(), "globalState.json");
const getSecretsPath = () => path.join(getDataDir(), "secrets.json");

const hasModelHubConfig = (globalState: Record<string, unknown> | null) => {
  if (!globalState) return false;
  const isOpenAi =
    globalState.actModeApiProvider === "openai" || globalState.planModeApiProvider === "openai";
  const baseUrl = String(globalState.openAiBaseUrl || "");
  return isOpenAi && (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes("modelhub"));
};

async function handleGet() {
  const installed = await checkCliOnPath("cline", getGlobalStatePath());
  if (!installed) {
    return { installed: false, settings: null, message: "Cline CLI is not installed" };
  }
  const globalState = await readJsonFile(getGlobalStatePath());
  return {
    installed: true,
    settings: {
      actModeApiProvider: globalState?.actModeApiProvider,
      planModeApiProvider: globalState?.planModeApiProvider,
      openAiBaseUrl: globalState?.openAiBaseUrl,
      openAiModelId: globalState?.openAiModelId,
    },
    hasModelHub: hasModelHubConfig(globalState),
    globalStatePath: getGlobalStatePath(),
  };
}

async function handlePost(body: Record<string, unknown>) {
  const { baseUrl, apiKey, model } = body;
  if (!baseUrl || !apiKey || !model) {
    throw new HttpValidationError("baseUrl, apiKey and model are required", 400);
  }

  await fs.mkdir(getDataDir(), { recursive: true });

  const normalizedBaseUrl = String(baseUrl).endsWith("/v1") ? String(baseUrl).slice(0, -3) : String(baseUrl);

  const globalState = (await readJsonFile(getGlobalStatePath())) || {};
  globalState.actModeApiProvider = "openai";
  globalState.planModeApiProvider = "openai";
  globalState.openAiBaseUrl = normalizedBaseUrl;
  globalState.openAiModelId = model;
  globalState.planModeOpenAiModelId = model;
  await fs.writeFile(getGlobalStatePath(), JSON.stringify(globalState, null, 2));

  const secrets = (await readJsonFile(getSecretsPath())) || {};
  secrets.openAiApiKey = apiKey;
  await fs.writeFile(getSecretsPath(), JSON.stringify(secrets, null, 2));

  return { success: true, message: "Cline settings applied successfully!", globalStatePath: getGlobalStatePath() };
}

async function handleDelete() {
  const globalState = await readJsonFile(getGlobalStatePath());
  if (!globalState) {
    return { success: true, message: "No settings file to reset" };
  }

  if (globalState.actModeApiProvider === "openai") {
    delete globalState.openAiBaseUrl;
    delete globalState.openAiModelId;
    delete globalState.planModeOpenAiModelId;
    globalState.actModeApiProvider = "cline";
    globalState.planModeApiProvider = "cline";
  }
  await fs.writeFile(getGlobalStatePath(), JSON.stringify(globalState, null, 2));

  const secrets = (await readJsonFile(getSecretsPath())) || {};
  delete secrets.openAiApiKey;
  await fs.writeFile(getSecretsPath(), JSON.stringify(secrets, null, 2));

  return { success: true, message: "ModelHub settings removed from Cline" };
}

export const { GET, POST, DELETE } = createCliToolHandlers("cline", {
  get: handleGet,
  post: handlePost,
  delete: handleDelete,
});
