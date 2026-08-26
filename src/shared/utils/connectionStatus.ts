export type StatusVariant = "secondary" | "default" | "destructive";

export type EffectiveStatus = "active" | "success" | "error" | "expired" | "unavailable" | string;

export function getStatusVariant(
  isActive: boolean | undefined,
  effectiveStatus: EffectiveStatus
): StatusVariant {
  if (isActive === false) return "secondary";
  if (effectiveStatus === "active" || effectiveStatus === "success") return "default";
  if (effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable") return "destructive";
  return "secondary";
}

export function getStatusClassName(
  isActive: boolean | undefined,
  effectiveStatus: EffectiveStatus
): string | undefined {
  if (isActive === false) return undefined;
  if (effectiveStatus === "active" || effectiveStatus === "success") return "bg-green-500/10 text-green-600 dark:text-green-400";
  if (effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable") return undefined;
  return undefined;
}
