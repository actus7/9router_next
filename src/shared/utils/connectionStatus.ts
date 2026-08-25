export type StatusVariant = "default" | "success" | "error";

export type EffectiveStatus = "active" | "success" | "error" | "expired" | "unavailable" | string;

export function getStatusVariant(
  isActive: boolean | undefined,
  effectiveStatus: EffectiveStatus
): StatusVariant {
  if (isActive === false) return "default";
  if (effectiveStatus === "active" || effectiveStatus === "success") return "success";
  if (effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable") return "error";
  return "default";
}
