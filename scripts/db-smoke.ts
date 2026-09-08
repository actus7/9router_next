/**
 * End-to-end check of the Neon Postgres layer against a real database.
 *
 * Everything else in tests/ mocks the adapter, which means nothing there would
 * catch the things that only Postgres can tell you: that `?` really became
 * `$n`, that a folded `machineid` really came back as `machineId`, that the
 * generated tsvector column really indexes what was written, that a thrown
 * error inside `transaction()` really rolls back. Those are asserted here.
 *
 * Needs a live `DATABASE_URL` in `.env`, so it is not part of `npm run check`.
 * Run it by hand after touching the adapter, the schema or a repo's SQL:
 *
 *     npx tsx scripts/db-smoke.ts
 *
 * It writes under two throwaway tenant ids and deletes them again at the end.
 */
import { readFileSync } from "node:fs";
import { createPostgresAdapter } from "../src/lib/db/adapters/postgresAdapter";
import { withTenant } from "../src/lib/db/tenant";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createPostgresAdapter(process.env.DATABASE_URL!);
(globalThis as Record<string, unknown>)._dbAdapter = { instance: db, initPromise: null };

const A = "smoke-tenant-a";
const B = "smoke-tenant-b";
const fails: string[] = [];
const check = (name: string, ok: boolean, got?: unknown) => {
  if (ok) console.log("  ok  " + name);
  else { fails.push(name); console.log("  FAIL " + name + "  got: " + JSON.stringify(got)); }
};

const { createApiKey, getApiKeys, resolveApiKeyOwner } = await import("../src/lib/db/repos/apiKeysRepo");
const { updateSettings, getSettings } = await import("../src/lib/db/repos/settingsRepo");
const { upsertHarnessMessageIndex, searchPastSessionMessages } = await import("../src/lib/db/repos/harnessMessageIndexRepo");
const { saveRequestUsage } = await import("../src/lib/db/repos/usageRepo");

const keyA = await withTenant(A, () => createApiKey("smoke A", "machine-a", "cli:smoke"));
const keyB = await withTenant(B, () => createApiKey("smoke B", "machine-b", "cli:smoke"));

// camelCase columns survive the round trip, and each tenant sees only its own.
const listA = await withTenant(A, () => getApiKeys());
check("apiKeys scoped to tenant A", listA.length === 1 && listA[0]!.name === "smoke A", listA.map((k) => k.name));
check("machineId remapped to camelCase", listA[0]!.machineId === "machine-a", listA[0]!.machineId);
check("isActive INTEGER reads as boolean true", listA[0]!.isActive === true, listA[0]!.isActive);
check("sink round-trips", listA[0]!.sink === "cli:smoke", listA[0]!.sink);

// The gateway resolver works with no tenant in context and finds the owner.
const owner = await resolveApiKeyOwner(keyB.key);
check("resolveApiKeyOwner returns the owning tenant", owner?.userId === B, owner);

// A transaction with a read-modify-write inside it.
await withTenant(A, () => updateSettings({ cloudEnabled: true, cloudUrl: "https://a.example" }));
await withTenant(B, () => updateSettings({ cloudEnabled: false }));
const setA = await withTenant(A, () => getSettings());
const setB = await withTenant(B, () => getSettings());
check("settings are per tenant", setA.cloudEnabled === true && setB.cloudEnabled === false, [setA.cloudEnabled, setB.cloudEnabled]);
check("settings merge with defaults", setA.cloudUrl === "https://a.example", setA.cloudUrl);

// Full-text search over the generated tsvector column.
await withTenant(A, () => upsertHarnessMessageIndex({
  sessionId: "s1", messageId: "m1", role: "user",
  content: "the quick brown fox jumps over the lazy dog", createdAt: new Date().toISOString(),
}));
await withTenant(B, () => upsertHarnessMessageIndex({
  sessionId: "s2", messageId: "m2", role: "user",
  content: "a completely different sentence about foxes", createdAt: new Date().toISOString(),
}));
const hitsA = await withTenant(A, () => searchPastSessionMessages({ query: "brown fox" }));
const hitsB = await withTenant(B, () => searchPastSessionMessages({ query: "brown fox" }));
check("tsvector search finds the row", hitsA.length === 1 && hitsA[0]!.sessionId === "s1", hitsA);
check("tsvector search highlights the match", hitsA[0]?.snippet.includes(">>"), hitsA[0]?.snippet);
check("tsvector search does not cross tenants", hitsB.length === 0, hitsB);

// A literal question mark in a string must survive placeholder translation.
await withTenant(A, () => upsertHarnessMessageIndex({
  sessionId: "s1", messageId: "m3", role: "user",
  content: "does the adapter handle a literal ? correctly", createdAt: new Date().toISOString(),
}));
const hitsQ = await withTenant(A, () => searchPastSessionMessages({ query: "literal correctly" }));
check("literal ? in content is stored verbatim", hitsQ.length === 1, hitsQ);

// usageHistory: identity PK, DOUBLE PRECISION cost, per-tenant lifetime counter.
await withTenant(A, () => saveRequestUsage({
  timestamp: new Date().toISOString(), provider: "openai", model: "gpt-4o",
  connectionId: "c1", apiKey: keyA.key, endpoint: "/v1/chat", cost: 0.000123,
  status: "ok", tokens: { prompt_tokens: 10, completion_tokens: 5 },
}));
const usage = await db.all(`SELECT id, cost, promptTokens FROM usageHistory WHERE userId = ?`, [A]);
check("usageHistory identity PK assigned", typeof usage[0]?.id === "number" || typeof usage[0]?.id === "string", usage[0]?.id);
// saveRequestUsage recomputes cost from the pricing table, so precision is
// asserted against a value written directly instead.
await db.run(`INSERT INTO usageHistory(userId, timestamp, cost) VALUES(?, ?, ?)`, [A, "2026-01-01T00:00:00.000Z", 0.000123456789]);
const precise = await db.get(`SELECT cost FROM usageHistory WHERE userId = ? AND timestamp = ?`, [A, "2026-01-01T00:00:00.000Z"]);
check("DOUBLE PRECISION keeps small costs exactly", precise?.cost === 0.000123456789, precise?.cost);
check("promptTokens remapped to camelCase", Number(usage[0]?.promptTokens) === 10, usage[0]);

const counts = await db.get(`SELECT COUNT(*) AS n FROM apiKeys WHERE userId = ?`, [A]);
check("COUNT(*) comes back as a number, not a string", typeof counts?.n === "number", typeof counts?.n);

// Rollback: a failing transaction must leave nothing behind.
try {
  await withTenant(A, () => db.transaction(async () => {
    await db.run(`INSERT INTO combos(id, userId, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ["rollback-1", A, "doomed", "x", "[]", "now", "now"]);
    throw new Error("deliberate");
  }));
} catch { /* expected */ }
const rolled = await db.get(`SELECT id FROM combos WHERE userId = ? AND id = ?`, [A, "rollback-1"]);
check("a throwing transaction rolls back", rolled === undefined, rolled);

// Clean up.
for (const t of ["apiKeys", "settings", "harnessMessageIndex", "usageHistory", "usageDaily", "kv", "combos"]) {
  await db.run(`DELETE FROM ${t} WHERE userId IN (?, ?)`, [A, B]);
}
await db.close();

console.log(fails.length ? `\nFAILED: ${fails.length}` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
