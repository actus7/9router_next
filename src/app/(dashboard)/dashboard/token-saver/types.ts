export interface HeadroomExtrasState {
  version: string | null;
  extras: Record<string, boolean>;
  available: string[];
  loading: boolean;
}

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

export interface ExtrasConfirmState {
  title: string;
  message: string;
  confirmText: string;
  variant: "primary" | "danger";
  onConfirm: () => void;
}

export const patchSetting = async (patch: Record<string, unknown>) => {
  try {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch (error) {
    console.error("Error updating setting:", error);
  }
};
