import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";

const execAsync: (command: string, options?: Record<string, unknown>) => Promise<{ stdout: string; stderr: string }> = promisify(exec);

// Install paths per provider per platform — Trae and standard Windsurf IDE locations.
const IDE_PATHS: Record<string, Record<string, string[]>> = {
  trae: {
    darwin: ["/Applications/Trae.app"],
    win32: [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Trae", "Trae.exe"),
      path.join(process.env.ProgramFiles || "", "Trae", "Trae.exe"),
    ],
    linux: ["/usr/bin/trae", "/usr/local/bin/trae", "/opt/trae", "/opt/Trae"],
  },
  windsurf: {
    darwin: ["/Applications/Windsurf.app"],
    win32: [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Windsurf", "Windsurf.exe"),
      path.join(process.env.ProgramFiles || "", "Windsurf", "Windsurf.exe"),
    ],
    linux: ["/usr/bin/windsurf", "/usr/local/bin/windsurf", "/opt/windsurf", "/opt/Windsurf"],
  },
};

const IDE_BINARIES: Record<string, string> = {
  trae: "trae",
  windsurf: "windsurf",
};

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function checkBinary(bin: string): Promise<boolean> {
  try {
    const cmd: string = os.platform() === "win32" ? `where ${bin}` : `which ${bin}`;
    await execAsync(cmd, { windowsHide: true });
    return true;
  } catch { return false; }
}

interface IdeDetectionResult {
  installed: boolean;
  path: string | null;
}

// Returns { installed: boolean, path: string|null } for the given provider's IDE.
export async function detectIdeInstalled(providerId: string): Promise<IdeDetectionResult> {
  const platform: string = os.platform();
  const paths: Record<string, string[]> | undefined = IDE_PATHS[providerId];
  if (!paths) return { installed: false, path: null };
  for (const p of paths[platform] || []) {
    if (p && await pathExists(p)) return { installed: true, path: p };
  }
  const bin: string | undefined = IDE_BINARIES[providerId];
  if (bin && await checkBinary(bin)) return { installed: true, path: bin };
  return { installed: false, path: null };
}
