import {
  CREDENTIAL_SECRET_FIELDS,
  encryptSecret,
  isCredentialEncryptionEnabled,
  isEncryptedValue,
} from "../helpers/credentialCipher";

interface DbAdapter {
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  run(sql: string, params?: unknown[]): { changes: number };
}

/**
 * Encrypt the credential fields already stored in `providerConnections.data`.
 *
 * A no-op when `CREDENTIAL_KEY` is unset: an install that never opted into
 * encryption must keep booting, so the migration records itself as applied and
 * leaves the rows alone. Setting the key later does NOT re-run this file — its
 * version is already stamped — but nothing breaks: new writes encrypt through
 * `connToRow`, and existing plaintext rows keep working because
 * `decryptConnectionSecrets` passes non-prefixed values through. Both forms
 * coexist by design.
 *
 * Idempotent: a value already carrying the `v1:` prefix is skipped, so running
 * twice cannot double-encrypt.
 *
 * Everything runs inside the migration transaction, so a throw on one row rolls
 * back every other row and pins the install at the previous schema version,
 * failing again on every boot — which is what migration 008 nearly did. Hence
 * the non-object guard: JSON.parse succeeds on "null", "42" and '"text"', so a
 * parse try/catch does not cover them.
 */
export default {
  version: 10,
  name: "cipher-connection-blob",
  up(db: DbAdapter): void {
    if (!isCredentialEncryptionEnabled()) return;

    const now = new Date().toISOString();
    for (const row of db.all("SELECT id, data FROM providerConnections")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(row.data || "{}"));
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const data = parsed as Record<string, unknown>;

      let changed = false;
      for (const field of CREDENTIAL_SECRET_FIELDS) {
        const value = data[field];
        if (typeof value !== "string" || !value || isEncryptedValue(value)) continue;
        data[field] = encryptSecret(value);
        changed = true;
      }
      if (!changed) continue;

      db.run("UPDATE providerConnections SET data = ?, updatedAt = ? WHERE id = ?", [
        JSON.stringify(data),
        now,
        row.id,
      ]);
    }
  },
};
