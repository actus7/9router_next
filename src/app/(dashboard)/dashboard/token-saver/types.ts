import { mutate } from "swr";

export interface PxpipeCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface PxpipeHealthData {
  healthy: boolean;
  checks: PxpipeCheck[];
  error?: string;
}

export const patchSetting = async (patch: Record<string, unknown>) => {
  try {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    mutate<Record<string, unknown>>(
      "/api/settings",
      (current) => ({ ...current, ...patch }),
      { revalidate: false },
    );
  } catch (error) {
    console.error("Error updating setting:", error);
  }
};
