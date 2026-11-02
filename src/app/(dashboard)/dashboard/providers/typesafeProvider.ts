import type { ProviderInfo, ProviderStats } from "./types";

// Direct TypeSafe credentials belong to the decision engine, not to the chat
// provider registry. List its existing configuration without creating a second key.
export const TYPESAFE_PROVIDER: ProviderInfo = {
  id: "typesafe-ai",
  alias: "typesafe-ai",
  category: "apikey",
  name: "TypeSafe (Jev)",
  serviceKinds: ["systemOne"],
};

export const TYPESAFE_SETTINGS_HREF = "/dashboard/profile#decision-engine";

export function getTypesafeProviderStats(hasKey: boolean | null): ProviderStats {
  // Saving this credential already tests it against TypeSafe. These counts
  // describe the saved key, independently of the Vercel connection or engine mode.
  const total = hasKey === true ? 1 : 0;
  return { connected: total, total, error: 0, errorCode: null, errorTime: null, allDisabled: false };
}
