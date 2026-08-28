// Provider icon paths under /public/providers.
// Icon files are named after the canonical provider id (e.g. kiro.png, opencode.png),
// but callers often only have the short routing alias (kr, oc). Resolve alias -> id first.
// Alias related brands; session-cache 404s so one miss never spams again.

import { resolveProviderId } from "@/shared/constants/providers";

const ICON_ALIASES: Record<string, string> = {
  "perplexity-agent": "perplexity",
  "gitlab-duo": "gitlab",
  "vercel-ai-gateway": "vercel",
};

// Runtime only — first 404 remembers id for the whole session
const failedIds = new Set<string>();

function normalizeId(providerId: string | null | undefined): string {
  if (!providerId || typeof providerId !== "string") return "";
  return providerId.trim().toLowerCase();
}

/** Resolve icon file id (after alias). Empty if previously failed this session. */
function resolveProviderIconId(providerId: string | null | undefined): string {
  const raw = normalizeId(providerId);
  if (!raw) return "";
  const id = normalizeId(resolveProviderId(raw)) || raw;
  if (failedIds.has(id)) return "";
  const aliased = ICON_ALIASES[id] || id;
  if (failedIds.has(aliased)) return "";
  return aliased;
}

/** `/providers/{id}.png` or null when previously failed. */
export function getProviderIconSrc(providerId: string | null | undefined): string | null {
  const id = resolveProviderIconId(providerId);
  return id ? `/providers/${id}.png` : null;
}

/** Call from img onError so later mounts skip the request. */
export function markProviderIconMissing(providerId: string | null | undefined): void {
  const id = normalizeId(providerId);
  if (id) failedIds.add(id);
  const aliased = ICON_ALIASES[id];
  if (aliased) failedIds.add(aliased);
}
