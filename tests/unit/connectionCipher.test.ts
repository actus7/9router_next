import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetCredentialKeyCache,
  assertCredentialEncryptionPolicy,
  decryptConnectionSecrets,
  encryptConnectionSecrets,
  encryptSecret,
  isCredentialEncryptionEnabled,
  isEncryptedValue,
} from "@/lib/db/helpers/credentialCipher";
import migration010 from "@/lib/db/migrations/010-cipher-connection-blob";

/**
 * Encryption at rest for the credential fields of providerConnections.data.
 *
 * Two properties matter beyond "it round-trips": an install with no
 * CREDENTIAL_KEY must keep working exactly as before (a security improvement
 * must not brick existing installs), and the migration must be idempotent and
 * tolerant of malformed rows — it runs inside a transaction, so one throw pins
 * the install at the previous schema version and fails on every boot.
 */
function withKey(value: string | undefined): void {
  if (value === undefined) delete process.env.CREDENTIAL_KEY;
  else process.env.CREDENTIAL_KEY = value;
  __resetCredentialKeyCache();
}

const BLOB = {
  apiKey: "sk-upstream-1234567890",
  accessToken: "ya29.token",
  refreshToken: "1//refresh",
  idToken: "eyJhbGc",
  email: "operator@example.com",
  testStatus: "active",
  consecutiveUseCount: 3,
};

function withRequired(required: boolean): void {
  if (required) process.env.CREDENTIAL_ENCRYPTION_REQUIRED = "true";
  else delete process.env.CREDENTIAL_ENCRYPTION_REQUIRED;
}

beforeEach(() => {
  withKey("unit-test-key");
  withRequired(false);
});
afterEach(() => {
  withKey(undefined);
  withRequired(false);
});

describe("credential cipher", () => {
  it("round-trips every secret field and leaves the rest untouched", () => {
    const stored = encryptConnectionSecrets(BLOB);

    for (const field of ["apiKey", "accessToken", "refreshToken", "idToken"] as const) {
      expect(isEncryptedValue(stored[field]), field).toBe(true);
      expect(String(stored[field])).not.toContain(String(BLOB[field]));
    }
    // Hot-path fields stay readable: account selection updates these on every
    // request and must not do cipher work.
    expect(stored.email).toBe(BLOB.email);
    expect(stored.testStatus).toBe("active");
    expect(stored.consecutiveUseCount).toBe(3);

    expect(decryptConnectionSecrets(stored)).toEqual(BLOB);
  });

  it("produces a different ciphertext each time, so equal keys are not linkable", () => {
    expect(encryptSecret("same-value")).not.toBe(encryptSecret("same-value"));
  });

  it("never double-encrypts an already encrypted value", () => {
    const once = encryptSecret("sk-abc");
    expect(encryptSecret(once)).toBe(once);
  });

  it("stores plaintext and reads it back when no key is configured", () => {
    withKey(undefined);
    expect(isCredentialEncryptionEnabled()).toBe(false);

    const stored = encryptConnectionSecrets(BLOB);
    expect(stored.apiKey).toBe(BLOB.apiKey);
    expect(decryptConnectionSecrets(stored)).toEqual(BLOB);
  });

  it("keeps reading plaintext rows after a key is introduced", () => {
    // A row written before encryption was enabled: no v1: prefix.
    expect(decryptConnectionSecrets({ apiKey: "sk-legacy" }).apiKey).toBe("sk-legacy");
  });

  it("drops a field it cannot decrypt instead of passing ciphertext upstream", () => {
    const stored = encryptConnectionSecrets({ apiKey: "sk-abc" });
    withKey("a-different-key");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const read = decryptConnectionSecrets(stored);

    // Ciphertext as a bearer token would produce a mystery 401; an absent
    // credential produces the accurate "no active credentials".
    expect(read).not.toHaveProperty("apiKey");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

/**
 * Running unencrypted stays supported — refusing to boot by default would brick
 * installs that never opted in. But an operator with a compliance requirement
 * needs to make it mandatory without editing source, and needs it to fail at
 * boot rather than degrade quietly. So the policy is configuration, and both
 * paths are asserted here.
 */
describe("encryption policy", () => {
  it("allows plaintext by default, so an existing install still boots", () => {
    withKey(undefined);
    withRequired(false);
    expect(() => assertCredentialEncryptionPolicy()).not.toThrow();
  });

  it("refuses to start when required but no key is configured", () => {
    withKey(undefined);
    withRequired(true);
    expect(() => assertCredentialEncryptionPolicy()).toThrow(/CREDENTIAL_KEY is not set/);
  });

  it("starts when required and the key is present", () => {
    withKey("unit-test-key");
    withRequired(true);
    expect(() => assertCredentialEncryptionPolicy()).not.toThrow();
  });

  it("ignores the flag unless it is exactly true", () => {
    withKey(undefined);
    process.env.CREDENTIAL_ENCRYPTION_REQUIRED = "1";
    expect(() => assertCredentialEncryptionPolicy()).not.toThrow();
    process.env.CREDENTIAL_ENCRYPTION_REQUIRED = "yes";
    expect(() => assertCredentialEncryptionPolicy()).not.toThrow();
  });
});

function fakeDb(rows: Array<{ id: string; data: string }>) {
  const writes: Array<{ id: string; data: string }> = [];
  return {
    writes,
    all: () => rows.map((row) => ({ ...row }) as Record<string, unknown>),
    run: (_sql: string, params?: unknown[]) => {
      writes.push({ data: String(params?.[0]), id: String(params?.[2]) });
      return { changes: 1 };
    },
  };
}

describe("migration 010", () => {
  it("encrypts the credential fields of existing rows", () => {
    const db = fakeDb([{ id: "c1", data: JSON.stringify({ apiKey: "sk-plain", email: "a@b.c" }) }]);

    migration010.up(db);

    expect(db.writes).toHaveLength(1);
    const written = JSON.parse(db.writes[0]!.data);
    expect(isEncryptedValue(written.apiKey)).toBe(true);
    expect(written.email).toBe("a@b.c");
  });

  it("is idempotent — a second run changes nothing", () => {
    const encrypted = JSON.stringify(encryptConnectionSecrets({ apiKey: "sk-plain" }));
    const db = fakeDb([{ id: "c1", data: encrypted }]);

    migration010.up(db);

    expect(db.writes).toEqual([]);
  });

  it("does nothing at all when no key is configured", () => {
    withKey(undefined);
    const db = fakeDb([{ id: "c1", data: JSON.stringify({ apiKey: "sk-plain" }) }]);

    migration010.up(db);

    // An install that never opted into encryption must keep booting untouched.
    expect(db.writes).toEqual([]);
  });

  it("skips blobs that are not objects without throwing", () => {
    // JSON.parse succeeds on all of these, so a parse try/catch does not cover
    // them: "null" yields null, and reading a property off it throws.
    const db = fakeDb([
      { id: "c1", data: "null" },
      { id: "c2", data: "42" },
      { id: "c3", data: '"text"' },
      { id: "c4", data: "[]" },
      { id: "c5", data: "{not json" },
      { id: "c6", data: JSON.stringify({ apiKey: "sk-good" }) },
    ]);

    expect(() => migration010.up(db)).not.toThrow();

    // The one good row still migrates, so a bad neighbour cannot cost the rest
    // of the table its encryption.
    expect(db.writes.map((w) => w.id)).toEqual(["c6"]);
  });
});
