"use client";
import { probeModel } from "../probeModel";

export async function testCustomModel(
  providerAlias: string,
  modelId: string,
): Promise<{ status: "ok" | "error"; error: string }> {
  try {
    const result = await probeModel(`${providerAlias}/${modelId}`);
    return { status: result.status, error: result.error };
  } catch (err: unknown) {
    return { status: "error", error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export function stripProviderAlias(id: string, providerAlias: string): string {
  const prefix = `${providerAlias}/`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}
