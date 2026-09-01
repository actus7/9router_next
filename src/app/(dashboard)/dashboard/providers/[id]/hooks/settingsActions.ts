"use client";

export async function saveProviderStrategy(
  providerId: string,
  strategy: string | null,
  stickyLimit: string,
) {
  try {
    const settingsRes = await fetch("/api/settings", { cache: "no-store" });
    const settingsData = settingsRes.ok ? await settingsRes.json() : {};
    const current = settingsData.providerStrategies || {};
    const override: Record<string, unknown> = {};
    if (strategy) override.fallbackStrategy = strategy;
    if (strategy === "round-robin" && stickyLimit !== "") override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
    const updated = { ...current };
    if (Object.keys(override).length === 0) delete updated[providerId];
    else updated[providerId] = override;
    await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerStrategies: updated }) });
  } catch (error) { console.error("Error saving provider strategy:", error); }
}

export async function saveThinkingConfig(providerId: string, mode: string) {
  try {
    const settingsRes = await fetch("/api/settings", { cache: "no-store" });
    const settingsData = settingsRes.ok ? await settingsRes.json() : {};
    const current = settingsData.providerThinking || {};
    const updated = { ...current };
    if (!mode || mode === "auto") delete updated[providerId];
    else updated[providerId] = { mode };
    await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerThinking: updated }) });
  } catch (error) { console.error("Error saving thinking config:", error); }
}

export async function saveAutoPingSetting(apKey: string, next: Record<string, unknown>) {
  try {
    await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [apKey]: next }) });
  } catch (error) { console.error("Error saving auto-ping config:", error); }
}
