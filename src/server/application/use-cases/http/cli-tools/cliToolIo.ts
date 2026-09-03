import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";

const execAsync = promisify(exec);

export function stripJsonc(content: string): string {
  return content.replace(/,(\s*[}\]])/g, "$1");
}

export async function readJsonFile<T = Record<string, unknown>>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(stripJsonc(content)) as T;
  } catch {
    return null;
  }
}

export async function checkCliOnPath(binary: string, fallbackPath?: string): Promise<boolean> {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? `where ${binary}` : `which ${binary}`;
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    if (!fallbackPath) return false;
    try {
      await fs.access(fallbackPath);
      return true;
    } catch {
      return false;
    }
  }
}
