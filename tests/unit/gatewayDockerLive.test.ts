import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAdapter } from "@/lib/db/driver";
import { withTenant } from "@/lib/db/tenant";
import { createApiKey, updateApiKey } from "@/lib/db/repos/apiKeysRepo";

/**
 * End to end against the running gateway (the Docker container, or any URL):
 * real HTTP into /v1/chat/completions through a smart combo, then the database
 * is read back to prove what the unit tests can only assume —
 *
 *   - smart routing ran, and Jev (when the account's engine is Jev) chose the tier;
 *   - modelPerf gets rows: an attempt, its generation speed, and the `|large`
 *     band for a big prompt (the stats seam was installed in instrumentation
 *     and invisible to the routes before processSlot).
 *
 * It spends real quota (a short prompt and a ~40k-token one) and creates a
 * throwaway API key on the account, revoked at the end (the row stays so the
 * usage it made remains attributable).
 *
 *   NODE_OPTIONS="-r dotenv/config" DOTENV_CONFIG_PATH=.env LIVE_DOCKER=1 \
 *     npx vitest run tests/unit/gatewayDockerLive.test.ts
 *
 * LIVE_GATEWAY_URL (default http://localhost:20128), LIVE_COMBO (default dev),
 * LIVE_RUN_USER (default: the owner of that combo).
 */
const live = process.env.LIVE_DOCKER === "1" && !!process.env.DATABASE_URL;
const BASE = process.env.LIVE_GATEWAY_URL || "http://localhost:20128";
const COMBO = process.env.LIVE_COMBO || "dev";
const LARGE_PROMPT_CHARS = 4 * 40_000;

// The app's own adapter: `?` placeholders, camelCase columns, like every repo.
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await (await getAdapter()).all(sql, params)) as T[];

let owner = "";
let keyId = "";
let key = "";
let startedAt = "";

/** Sends one streamed chat request and reads it to the end, like a client would. */
async function chat(content: string): Promise<{ status: number; text: string; raw: string; model: string | null }> {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: COMBO, stream: true, messages: [{ role: "user", content }] }),
  });
  const body = await res.text();
  let text = "";
  let model: string | null = null;
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
    try {
      const chunk = JSON.parse(line.slice(5));
      model = chunk.model ?? model;
      text += chunk.choices?.[0]?.delta?.content ?? "";
    } catch { /* keep-alive or partial line */ }
  }
  return { status: res.status, text, raw: body.slice(0, 500), model };
}

/** The gateway writes usage and measurements after the response (waitUntil): give it a moment. */
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1_000));
    value = await read();
  }
  return value;
}

describe.skipIf(!live)(`gateway in Docker, combo "${COMBO}"`, () => {
  beforeAll(async () => {
    owner = process.env.LIVE_RUN_USER
      || (await q<{ userId: string }>("SELECT userId FROM combos WHERE name = ? LIMIT 1", [COMBO]))[0]?.userId
      || "";
    expect(owner, `no combo named ${COMBO}`).not.toBe("");
    const created = await withTenant(owner, () => createApiKey("Teste ponta a ponta (gatewayDockerLive)", "e2e-test"));
    keyId = created.id;
    key = created.key;
    startedAt = new Date().toISOString();
  }, 30_000);

  afterAll(async () => {
    if (keyId) await withTenant(owner, () => updateApiKey(keyId, { isActive: false, revokedAt: new Date().toISOString() }));
  });

  it("answers a short prompt through smart routing, with the tier chosen by the account's engine", async () => {
    const res = await chat("Prove that the square root of 2 is irrational, in two sentences.");
    expect(res.status, res.raw).toBe(200);
    // The answer itself, from the stream's content deltas — not just a 200.
    expect(res.text.trim().length, res.raw).toBeGreaterThan(0);

    const [detail] = await eventually(
      () => q<{ routing: Record<string, unknown> | null }>(
        "SELECT COALESCE(data::jsonb -> 'routing', data::jsonb #> '{request,routing}') AS routing FROM requestDetails WHERE userId = ? AND timestamp > ? AND COALESCE(data::jsonb -> 'routing', data::jsonb #> '{request,routing}') IS NOT NULL ORDER BY timestamp DESC LIMIT 1",
        [owner, startedAt],
      ),
      (rows) => rows.length > 0,
    );
    expect(detail?.routing, "no routing decision recorded (observability off?)").toBeTruthy();
    const engine = (await q<{ engine: string | null }>("SELECT data::jsonb ->> 'decisionEngine' AS engine FROM settings WHERE userId = ?", [owner]))[0]?.engine;
    if (engine === "jev") expect(detail.routing!.classifierSource, JSON.stringify(detail.routing)).toBe("jev");
  }, 180_000);

  it("records the attempt and its generation speed in modelPerf", async () => {
    const rows = await eventually(
      () => q<{ modelKey: string; ok: number; genTokens: number }>(
        "SELECT modelKey, ok, genTokens FROM modelPerf WHERE userId = ? AND modelKey NOT LIKE '%|large'",
        [owner],
      ),
      (r) => r.some((row) => Number(row.ok) > 0) && r.some((row) => Number(row.genTokens) > 0),
    );
    expect(rows.some((row) => Number(row.ok) > 0), JSON.stringify(rows)).toBe(true);
    expect(rows.some((row) => Number(row.genTokens) > 0), JSON.stringify(rows)).toBe(true);
  }, 60_000);

  it("measures a large prompt under the model's |large band", async () => {
    const filler = "Context line about an unrelated inventory record. ".repeat(Math.ceil(LARGE_PROMPT_CHARS / 50));
    const res = await chat(`${filler}\n\nIgnore the context above and reply with just: ok`);
    expect(res.status, res.raw).toBe(200);
    expect(res.text.trim().length, res.raw).toBeGreaterThan(0);
    const rows = await eventually(
      () => q<{ modelKey: string; ok: number }>("SELECT modelKey, ok FROM modelPerf WHERE userId = ? AND modelKey LIKE '%|large'", [owner]),
      (r) => r.some((row) => Number(row.ok) > 0),
    );
    expect(rows.some((row) => Number(row.ok) > 0), JSON.stringify(rows)).toBe(true);
    // The large prompt truncates the stored request; the routing decision lives beside it.
    const [detail] = await eventually(
      () => q<{ routing: Record<string, unknown> | null }>(
        "SELECT data::jsonb -> 'routing' AS routing FROM requestDetails WHERE userId = ? AND timestamp > ? AND data::jsonb #>> '{request,_truncated}' = 'true' ORDER BY timestamp DESC LIMIT 1",
        [owner, startedAt],
      ),
      (r) => r.length > 0 && !!r[0].routing,
    );
    expect(detail?.routing, "large prompt lost its routing decision").toMatchObject({ tier: expect.any(String) });
  }, 300_000);
});
