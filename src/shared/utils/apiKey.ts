import crypto from "crypto";

const API_KEY_SECRET: string = process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret";


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
 * Generate CRC (8-char HMAC)
 */
function generateCrc(machineId: string, keyId: string): string {
  return crypto
    .createHmac("sha256", API_KEY_SECRET)
    .update(machineId + keyId)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Generate API key with machineId embedded
 * Format: sk-{machineId}-{keyId}-{crc8}
 */
export function generateApiKeyWithMachine(machineId: string): GeneratedApiKey {
  const keyId = generateKeyId();
  const crc = generateCrc(machineId, keyId);
  const key = `sk-${machineId}-${keyId}-${crc}`;
  return { key, keyId };
}

/**
 * Parse API key and extract machineId + keyId
 * Supports both formats:
 * - New: sk-{machineId}-{keyId}-{crc8}
 * - Old: sk-{random8}
 */

/**
 * Verify API key CRC (only for new format)
 */

/**
 * Check if API key is new format (contains machineId)
 */
