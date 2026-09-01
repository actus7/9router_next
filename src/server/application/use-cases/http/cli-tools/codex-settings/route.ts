import { NextRequest, NextResponse  } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseTOML, stringifyTOML } from "confbox";

const execAsync = promisify(exec);

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
const checkCodexInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where codex" : "which codex";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getCodexConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

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

// GET - Check codex CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkCodexInstalled();
    
    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Codex CLI is not installed",
      });
    }

    const config = await readConfig();

    return NextResponse.json({
      installed: true,
      config,
      hasModelHub: hasModelHubConfig(config),
      configPath: getCodexConfigPath(),
    });
  } catch (error) {
    console.error("Error checking codex settings:", error);
    return NextResponse.json({ error: "Failed to check codex settings" }, { status: 500 });
  }
}

// POST - Update ModelHub settings (merge with existing config)
export async function POST(request: NextRequest) {
  try {
    const { baseUrl, apiKey, model, subagentModel } = await request.json();
    
    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    const codexDir = getCodexDir();
    const configPath = getCodexConfigPath();

    // Ensure directory exists
    await fs.mkdir(codexDir, { recursive: true });

    // Read and parse existing config
    let parsed: Record<string, unknown> = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parsedToWritable(parseTOML(existingConfig));
    } catch { /* No existing config */ }

    // Update only ModelHub related fields (api_key goes to auth.json, not config.toml)
    parsed.model = model;
    parsed.model_provider = "modelhub";

    // Update or create modelhub provider section (no api_key - Codex reads from auth.json)
    // Ensure /v1 suffix is added only once
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    setNestedSection(parsed, "model_providers.modelhub", {
      name: "ModelHub",
      base_url: normalizedBaseUrl,
      wire_api: "responses",
    });

    // Add subagent configuration
    const effectiveSubagentModel = subagentModel || model;
    setNestedSection(parsed, "agents.subagent", {
      model: effectiveSubagentModel,
    });

    // Write merged config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    // Update auth.json with OPENAI_API_KEY (Codex reads this first)
    const authPath = getCodexAuthPath();
    let authData: Record<string, unknown> = {};
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      authData = JSON.parse(existingAuth);
    } catch { /* No existing auth */ }
    
    // Force apikey mode (keep existing tokens untouched for ChatGPT login reuse)
    authData.OPENAI_API_KEY = apiKey;
    authData.auth_mode = "apikey";
    await fs.writeFile(authPath, JSON.stringify(authData, null, 2));

    return NextResponse.json({
      success: true,
      message: "Codex settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.error("Error updating codex settings:", error);
    return NextResponse.json({ error: "Failed to update codex settings" }, { status: 500 });
  }
}

// DELETE - Remove ModelHub settings only (keep other settings)
export async function DELETE() {
  try {
    const configPath = getCodexConfigPath();

    // Read and parse existing config
    let parsed: Record<string, unknown> = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parsedToWritable(parseTOML(existingConfig));
    } catch (error: unknown) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No config file to reset",
        });
      }
      throw error;
    }

    // Remove ModelHub related root fields only if they point to modelhub
    if (parsed.model_provider === "modelhub") {
      delete parsed.model;
      delete parsed.model_provider;
    }

    // Remove modelhub provider section
    deleteNestedSection(parsed, "model_providers.modelhub");

    // Remove subagent configuration
    deleteNestedSection(parsed, "agents.subagent");

    // Write updated config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    // Remove OPENAI_API_KEY from auth.json
    const authPath = getCodexAuthPath();
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      const authData = JSON.parse(existingAuth);
      delete authData.OPENAI_API_KEY;
      delete authData.auth_mode;

      // Write back or delete if empty
      if (Object.keys(authData).length === 0) {
        await fs.unlink(authPath);
      } else {
        await fs.writeFile(authPath, JSON.stringify(authData, null, 2));
      }
    } catch { /* No auth file */ }

    return NextResponse.json({
      success: true,
      message: "ModelHub settings removed successfully",
    });
  } catch (error) {
    console.error("Error resetting codex settings:", error);
    return NextResponse.json({ error: "Failed to reset codex settings" }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
