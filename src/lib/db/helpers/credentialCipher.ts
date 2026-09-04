import crypto from "node:crypto";

/**
 * Encryption at rest for the secret fields inside `providerConnections.data`.
 *
 * Only the secrets are encrypted — `apiKey`, `accessToken`, `refreshToken`,
 * `idToken` — and deliberately not the whole blob. `email`, `testStatus`,
 * `lastError` and `consecutiveUseCount` live in the same JSON and are read and
 * written on the hot path (the round-robin bookkeeping updates on every
 * request), so encrypting the blob would put cipher work in account selection.
 *
 * Custody is an env var. The alternatives were considered and rejected: the OS
 * keychain adds a native dependency and breaks headless Docker, which
 * contradicts the four-driver SQLite fallback that exists precisely to avoid
 * native deps; and deriving the key from the machine id protects against almost
 * nothing, since whoever has the database file usually has the machine — that
 * is encryption that only looks like encryption, which is worse than none
 * because it creates trust that does not match the protection.
 *
 * With no key configured the values are stored as-is. An existing install must
 * not stop booting because of a security improvement it never opted into; the
 * state is surfaced instead (see `isCredentialEncryptionEnabled`).
 */

/** Version prefix so the format can change later without a second guessing migration. */
const PREFIX = "v1:";

/** Fixed salt: the env value is the secret, the salt only domain-separates it. */
const KDF_SALT = "modelhub.credential.v1";

const SECRET_FIELDS = ["apiKey", "accessToken", "refreshToken", "idToken"] as const;

let cachedKey: Buffer | null | undefined;

function resolveKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const secret = process.env.CREDENTIAL_KEY?.trim();
  cachedKey = secret ? crypto.scryptSync(secret, KDF_SALT, 32) : null;
  return cachedKey;
}

/** Test seam: the env is read once and cached, so a test changing it must reset. */
export function __resetCredentialKeyCache(): void {
  cachedKey = undefined;
}

export function isCredentialEncryptionEnabled(): boolean {
  return resolveKey() !== null;
}

/** Whether the operator has declared encryption mandatory for this install. */
export function isCredentialEncryptionRequired(): boolean {
  return process.env.CREDENTIAL_ENCRYPTION_REQUIRED?.trim().toLowerCase() === "true";
}

/**
 * Enforce the operator's encryption policy at startup.
 *
 * Running unencrypted is a supported mode — refusing to boot by default would
 * brick installs that never opted in, which is why the key is optional. But
 * "supported" is not the same as "acceptable everywhere": an operator with a
 * compliance requirement needs a way to make it mandatory that does not involve
 * editing this file, and needs it to fail at boot rather than silently degrade.
 *
 * So the policy is configuration, not a code decision:
 *   CREDENTIAL_KEY unset                              -> plaintext, warned every boot
 *   CREDENTIAL_KEY set                                -> encrypted
 *   CREDENTIAL_ENCRYPTION_REQUIRED=true, key missing   -> refuse to start
 *
 * @throws when encryption is required but no key is configured
 */
export function assertCredentialEncryptionPolicy(): void {
  if (!isCredentialEncryptionRequired() || isCredentialEncryptionEnabled()) return;
  throw new Error(
    "CREDENTIAL_ENCRYPTION_REQUIRED=true but CREDENTIAL_KEY is not set. " +
      "Set CREDENTIAL_KEY to encrypt provider credentials at rest, or unset " +
      "CREDENTIAL_ENCRYPTION_REQUIRED to allow plaintext storage.",
  );
}

export function isEncryptedValue(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Encrypt one value. Returns it unchanged when no key is configured or it is already encrypted. */
export function encryptSecret(value: string): string {
  const key = resolveKey();
  if (!key || !value || isEncryptedValue(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypt one value.
 *
 * A stored plaintext value passes through, so a database written before the key
 * existed keeps working. A value that IS encrypted but cannot be decrypted
 * returns undefined rather than the ciphertext: handing ciphertext upstream as
 * a bearer token produces a mystery 401, while an absent credential produces
 * the accurate "no active credentials" error. The failure is logged with the
 * reason, since it means the key changed or was removed.
 */
export function decryptSecret(stored: string): string | undefined {
  if (!isEncryptedValue(stored)) return stored;
  const key = resolveKey();
  if (!key) {
    console.error(
      "[credentialCipher] Encrypted credential found but CREDENTIAL_KEY is not set — the credential is unusable until the key is restored.",
    );
    return undefined;
  }
  const [, ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    console.error("[credentialCipher] Malformed encrypted credential — skipping.");
    return undefined;
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    // GCM authentication failed: wrong key, or the row was tampered with.
    console.error(
      `[credentialCipher] Could not decrypt a credential (${
        error instanceof Error ? error.message : String(error)
      }) — CREDENTIAL_KEY may have changed.`,
    );
    return undefined;
  }
}

/** Encrypt the secret fields of a connection blob in place-ish (returns a new object). */
export function encryptConnectionSecrets(
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (!isCredentialEncryptionEnabled()) return data;
  const next = { ...data };
  for (const field of SECRET_FIELDS) {
    const value = next[field];
    if (typeof value === "string" && value) next[field] = encryptSecret(value);
  }
  return next;
}

/** Decrypt the secret fields of a connection blob. Undecryptable fields are dropped. */
export function decryptConnectionSecrets(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...data };
  for (const field of SECRET_FIELDS) {
    const value = next[field];
    if (typeof value !== "string" || !value) continue;
    const plain = decryptSecret(value);
    if (plain === undefined) delete next[field];
    else next[field] = plain;
  }
  return next;
}

export const CREDENTIAL_SECRET_FIELDS: readonly string[] = SECRET_FIELDS;
