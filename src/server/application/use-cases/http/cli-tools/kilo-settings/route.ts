import fs from "fs/promises";
import path from "path";
import os from "os";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { checkCliOnPath, readJsonFile } from "@/server/application/use-cases/http/cli-tools/cliToolIo";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";

const getDataDir = () => path.join(os.homedir(), ".local", "share", "kilo");
const getAuthPath = () => path.join(getDataDir(), "auth.json");
const getVscodeSettingsPath = () => path.join(os.homedir(), ".config", "Code", "User", "settings.json");

const hasModelHubConfig = (auth: Record<string, unknown> | null) => {
  if (!auth) return false;
  const entry = auth["openai-compatible"] || auth["modelhub"];
  if (!entry) return false;
  const entryObj = entry as Record<string, unknown>;
  const baseUrl = (entryObj.baseUrl || entryObj.baseURL || "") as string;
  return baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes("modelhub");
};

async function handleGet() {
  const installed = await checkCliOnPath("kilo", getAuthPath());
  if (!installed) {
    return { installed: false, settings: null, message: "Kilo Code CLI is not installed" };
  }
  const auth = await readJsonFile(getAuthPath());
  return {
    installed: true,
    settings: { auth: auth ? Object.keys(auth) : [] },
    hasModelHub: hasModelHubConfig(auth),
    authPath: getAuthPath(),
  };
}

async function handlePost(body: Record<string, unknown>) {
  const { baseUrl, apiKey, model } = body;
  if (!baseUrl || !apiKey || !model) {
    throw new HttpValidationError("baseUrl, apiKey and model are required", 400);
  }

  await fs.mkdir(getDataDir(), { recursive: true });

  const normalizedBaseUrl = String(baseUrl).endsWith("/v1") ? String(baseUrl) : `${baseUrl}/v1`;

  const auth = (await readJsonFile(getAuthPath())) || {};
  auth["openai-compatible"] = {
    type: "api-key",
    apiKey,
    baseUrl: normalizedBaseUrl,
    model,
  };
  await fs.writeFile(getAuthPath(), JSON.stringify(auth, null, 2));

  try {
    const vscode = (await readJsonFile(getVscodeSettingsPath())) || {};
    vscode["kilocode.customProvider"] = { name: "ModelHub", baseURL: normalizedBaseUrl, apiKey };
    vscode["kilocode.defaultModel"] = model;
    await fs.writeFile(getVscodeSettingsPath(), JSON.stringify(vscode, null, 2));
  } catch { /* VS Code settings not writable */ }

  return { success: true, message: "Kilo Code settings applied successfully!", authPath: getAuthPath() };
}

async function handleDelete() {
  const auth = await readJsonFile(getAuthPath());
  if (!auth) {
    return { success: true, message: "No settings file to reset" };
  }
  delete auth["openai-compatible"];
  delete auth["modelhub"];
  await fs.writeFile(getAuthPath(), JSON.stringify(auth, null, 2));

  try {
    const vscode = await readJsonFile(getVscodeSettingsPath());
    if (vscode) {
      delete vscode["kilocode.customProvider"];
      delete vscode["kilocode.defaultModel"];
      await fs.writeFile(getVscodeSettingsPath(), JSON.stringify(vscode, null, 2));
    }
  } catch { /* ignore */ }

  return { success: true, message: "ModelHub settings removed from Kilo Code" };
}

export const { GET, POST, DELETE } = createCliToolHandlers("kilo", {
  get: handleGet,
  post: handlePost,
  delete: handleDelete,
});
