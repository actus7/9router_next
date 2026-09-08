// Provider icon paths under /public/providers.
// Icon files are named after the canonical provider id (e.g. kiro.png, opencode.png),
// but callers often only have the short routing alias (kr, oc). Resolve alias -> id first.
// Alias related brands; the generated manifest decides what actually ships, so a provider
// with no asset falls back to its text badge instead of 404ing on every dashboard mount.

import { PROVIDER_ICON_FILES } from "@/shared/constants/providerIconFiles";
import { resolveProviderId } from "@/shared/constants/providers";

const ICON_ALIASES: Record<string, string> = {
  "perplexity-agent": "perplexity",
  "gitlab-duo": "gitlab",
  "vercel-ai-gateway": "vercel",
  "venice-web": "venice",
  "v0-vercel": "vercel",
  "v0-vercel-web": "vercel",
};

// Runtime only — first 404 remembers id for the whole session
const failedIds = new Set<string>();

function normalizeId(providerId: string | null | undefined): string {
  if (!providerId || typeof providerId !== "string") return "";
  return providerId.trim().toLowerCase();
}

/** Resolve the shipped icon file (after alias). Empty if missing or failed this session. */
function resolveProviderIconFile(providerId: string | null | undefined): string {
  const raw = normalizeId(providerId);
  if (!raw) return "";
  const id = normalizeId(resolveProviderId(raw)) || raw;
  for (const candidate of [id, ICON_ALIASES[id] || ""]) {
    if (!candidate || failedIds.has(candidate)) continue;
    const file = PROVIDER_ICON_FILES[candidate];
    if (file) return file;
  }
  return "";
}

/** `/providers/{file}` or null when not shipped / previously failed. */
export function getProviderIconSrc(providerId: string | null | undefined): string | null {
  const file = resolveProviderIconFile(providerId);
  return file ? `/providers/${file}` : null;
}

/** Call from img onError so later mounts skip the request. */
export function markProviderIconMissing(providerId: string | null | undefined): void {
  const id = normalizeId(providerId);
  if (id) failedIds.add(id);
  const aliased = ICON_ALIASES[id];
  if (aliased) failedIds.add(aliased);
}
