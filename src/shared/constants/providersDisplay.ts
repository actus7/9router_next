// UI display config — all providers derive from registry.display.
import { REGISTRY } from "@/shared/llm-catalog";

export const RISK_NOTICE = "\u26A0\uFE0F Risk Notice: This provider uses a subscription/OAuth session not officially licensed for proxy/router use. Account may be restricted or banned. Use at your own risk." as const;

// Resolve "RISK_NOTICE" token → real notice text (registry stores token to avoid import cycle)
const resolveDisplay = (d: Record<string, unknown>): Record<string, unknown> =>
  d.deprecationNotice === "RISK_NOTICE" ? { ...d, deprecationNotice: RISK_NOTICE } : d;

void (Object.fromEntries(
  REGISTRY.filter((r: Record<string, unknown>) => r.display).map((r: Record<string, unknown>) => [r.id, resolveDisplay(r.display as Record<string, unknown>)]),
));
