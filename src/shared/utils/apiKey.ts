import crypto from "crypto";

export interface GeneratedApiKey {
  key: string;
  keyId: string;
}

/**
 * Generate 6-char random keyId
 */
function generateKeyId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate API key with machineId embedded.
 * Format: sk-{machineId}-{keyId}-{suffix8}
 *
 * The suffix used to be an HMAC over machineId+keyId keyed by an API_KEY_SECRET
 * env var that fell back to a hard-coded string. Nothing ever verified it:
 * `validateApiKey` is a `WHERE key = ?` equality check against the apiKeys
 * table, so the trust boundary is the stored row, never the suffix. A keyed
 * digest no reader checks is complexity that looks like security, so the suffix
 * is now just random bytes — same format, no secret to leak or rotate.
 */
export function generateApiKeyWithMachine(machineId: string): GeneratedApiKey {
  const keyId = generateKeyId();
  const suffix = crypto.randomBytes(4).toString("hex");
  const key = `sk-${machineId}-${keyId}-${suffix}`;
  return { key, keyId };
}
