/**
 * Thought signatures Antigravity/Gemini attach to function calls, kept so the
 * next request can replay the real one instead of the default stand-in.
 * Ported from decolua/9router thoughtSignatureStore.js, in memory only: the
 * upstream also persists to SQLite, but the default signature remains the
 * fallback, so a lost entry (restart, another instance) degrades to the
 * previous behavior rather than failing.
 */

const MAX_SIGNATURES = 2000;
const MEMORY_TTL_MS = 60 * 60 * 1000; // 1 hour

interface Entry {
  signature: string;
  family: string | null;
  expiresAt: number;
}

const signatures = new Map<string, Entry>();

/** Exported for tests only. */
export function _clearThoughtSignatures(): void {
  signatures.clear();
}

/**
 * Model family that produced / will consume a signature. Antigravity serves
 * Gemini and Claude behind the same API, and each backend only accepts its own:
 * a Claude signature replayed to Gemini is a 400 "Corrupted thought signature".
 */
export function signatureFamily(model: unknown): string | null {
  const id = typeof model === "string" ? model.toLowerCase() : "";
  if (!id) return null;
  if (id.includes("claude")) return "claude";
  if (id.includes("gemini")) return "gemini";
  return id;
}

function isCompatible(entry: Entry, family: string | null): boolean {
  return !entry.family || !family || entry.family === family;
}

function prune(): void {
  const now = Date.now();
  for (const [key, value] of signatures) {
    if (value.expiresAt <= now) signatures.delete(key);
  }
  while (signatures.size > MAX_SIGNATURES) {
    const oldest = signatures.keys().next().value;
    if (oldest === undefined) break;
    signatures.delete(oldest);
  }
}

/** Store a signature for a tool_call_id, optionally namespaced by session. */
export function storeGeminiThoughtSignature(
  toolCallId: unknown,
  signature: unknown,
  sessionId: string | null = null,
  model: unknown = null,
): void {
  if (typeof toolCallId !== "string" || !toolCallId) return;
  if (typeof signature !== "string" || !signature) return;
  const entry: Entry = { signature, family: signatureFamily(model), expiresAt: Date.now() + MEMORY_TTL_MS };
  prune();
  if (sessionId) signatures.set(`${sessionId}:${toolCallId}`, entry);
  signatures.set(toolCallId, entry);
}

/** Look a signature up (session namespace first); another family's is ignored. */
export function getGeminiThoughtSignatureSync(
  toolCallId: unknown,
  sessionId: string | null = null,
  model: unknown = null,
): string | null {
  if (typeof toolCallId !== "string" || !toolCallId) return null;
  const family = signatureFamily(model);
  prune();
  const keys = sessionId ? [`${sessionId}:${toolCallId}`, toolCallId] : [toolCallId];
  for (const key of keys) {
    const entry = signatures.get(key);
    if (entry && entry.expiresAt > Date.now() && isCompatible(entry, family)) return entry.signature;
  }
  return null;
}
