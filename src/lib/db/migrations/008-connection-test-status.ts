interface DbAdapter {
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  run(sql: string, params?: unknown[]): { changes: number };
}

// What earlier versions wrote into providerConnections.data.testStatus, mapped
// to the closed set the repo now exposes. The targets match how the dashboard
// already bucketed these values, so no row changes how it renders.
const LEGACY_STATUS: Record<string, "active" | "error"> = {
  success: "active",
  expired: "error",
  unavailable: "error",
};

const CLOSED_SET: ReadonlySet<string> = new Set(["active", "error", "unknown"]);

/**
 * Normalizes the connection test status in place. `testStatus` means the result
 * of a connection test and nothing else; it used to be written by the runtime,
 * by OAuth imports and by the browser, each with its own vocabulary.
 * Credentials in the same blob are left untouched.
 */
export default {
  version: 8,
  name: "connection-test-status",
  up(db: DbAdapter): void {
    const now = new Date().toISOString();
    for (const row of db.all("SELECT id, data FROM providerConnections")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(row.data || "{}"));
      } catch {
        continue;
      }
      // JSON.parse succeeds on "null", "42" and '"text"', so the catch above
      // does not cover them. Reading a property off those throws, and this
      // runs inside the migration's transaction: one malformed row would roll
      // back every other row and pin the install at the previous schema
      // version, failing again on every boot.
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const data = parsed as Record<string, unknown>;

      const current = data.testStatus;
      if (current === undefined || CLOSED_SET.has(String(current))) continue;

      const mapped = LEGACY_STATUS[String(current)];
      // An unrecognized value is not evidence of anything, so it becomes
      // "unknown" rather than being guessed into a pass or a failure.
      data.testStatus = mapped ?? "unknown";

      db.run("UPDATE providerConnections SET data = ?, updatedAt = ? WHERE id = ?", [
        JSON.stringify(data),
        now,
        row.id,
      ]);
    }
  },
};
