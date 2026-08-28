import type { CloudToolManifest } from "./types";
import { openclawManifest } from "./openclaw";

export const CLOUD_TOOLS: Record<string, CloudToolManifest> = {
  openclaw: openclawManifest,
};

export function getCloudTool(toolId: string): CloudToolManifest | null {
  return CLOUD_TOOLS[toolId] ?? null;
}

export function listCloudTools(): CloudToolManifest[] {
  return Object.values(CLOUD_TOOLS);
}

export type { CloudToolManifest, CloudToolStartup, CloudToolEnvInput, CloudToolInfo } from "./types";
