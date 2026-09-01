"use client";

export async function testCustomModel(
  providerAlias: string,
  modelId: string,
): Promise<{ status: "ok" | "error"; error: string }> {
  try {
    const res = await fetch("/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: `${providerAlias}/${modelId}` }),
    });
    const data = await res.json();
    return { status: data.ok ? "ok" : "error", error: data.error || "" };
  } catch (err: unknown) {
    return { status: "error", error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export function stripProviderAlias(id: string, providerAlias: string): string {
  const prefix = `${providerAlias}/`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}
