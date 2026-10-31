import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { getAdapter } from "@/lib/db/driver";
import { withTenant } from "@/lib/db/tenant";
import { createApiKey, updateApiKey } from "@/lib/db/repos/apiKeysRepo";
import { buildModelsList } from "@/server/application/use-cases/http/v1/models/buildModelsList";
import { handleChat } from "@/server/llm-gateway/chat";
import { initTranslators } from "@/server/llm-gateway/translator";
import REGISTRY from "@/server/llm-gateway/engine/providers/registry";
import type { RegistryEntry } from "@/server/llm-gateway/engine/providers/schema";

/**
 * One battery for every LLM provider, against the real account and the real
 * upstream: the model list, a plain chat, a stream and — where the provider
 * claims it — tool calling. It is the definition of "works" the provider
 * test teams share, so one provider is never held to an easier bar than another.
 *
 * Nothing is mocked. Off by default: it spends quota and needs DATABASE_URL.
 * A throwaway API key is created on the account and revoked at the end.
 *
 *   NODE_OPTIONS="-r dotenv/config" DOTENV_CONFIG_PATH=.env \
 *     LIVE_PROVIDER=<registry id> [LIVE_PROVIDER_USER=<uuid>] [LIVE_PROVIDER_MODEL=<alias/model>] \
 *     [LIVE_PROVIDER_REPORT=<path.json>] npx vitest run tests/unit/providerMatrixLive.test.ts
 *
 * LIVE_PROVIDER_USER defaults to the owner of the provider's first active
 * connection, else (keyless providers) to the owner of any active connection.
 */
const providerId = process.env.LIVE_PROVIDER || "";
const live = !!providerId && !!process.env.DATABASE_URL;
const entry = (REGISTRY as RegistryEntry[]).find((p) => p.id === providerId);
const toolCalling = (entry?.features as { toolCalling?: boolean } | undefined)?.toolCalling !== false;
const CALL_TIMEOUT_MS = 120_000;
// Reasoning models spend part of the budget thinking before they answer or call a tool.
const MAX_TOKENS = 1024;

const report: Record<string, unknown> = { provider: providerId };
let owner = "";
let keyId = "";
let key = "";
let model = process.env.LIVE_PROVIDER_MODEL || "";

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await (await getAdapter()).all(sql, params)) as T[];

async function chat(body: Record<string, unknown>): Promise<{ status: number; raw: string }> {
  const res = await withTenant(owner, () =>
    handleChat(new Request("http://localhost/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, ...body }),
    }) as never),
  );
  return { status: res.status, raw: await res.text() };
}

describe.skipIf(!live)(`provider ${providerId} against the real account`, () => {
  beforeAll(async () => {
    expect(entry, `no registry entry ${providerId}`).toBeTruthy();
    initTranslators();
    owner = process.env.LIVE_PROVIDER_USER
      || (await q<{ userId: string }>("SELECT userId FROM providerConnections WHERE provider = ? AND isActive = 1 LIMIT 1", [providerId]))[0]?.userId
      || (entry?.noAuth ? (await q<{ userId: string }>("SELECT userId FROM providerConnections WHERE isActive = 1 LIMIT 1"))[0]?.userId : "")
      || "";
    report.owner = owner;
    report.credential = owner ? "ok" : "missing";
    expect(owner, "no account with a credential for this provider").not.toBe("");
    const created = await withTenant(owner, () => createApiKey(`Teste de provedor (${providerId})`, "provider-matrix"));
    keyId = created.id;
    key = created.key;
  }, 60_000);

  afterAll(async () => {
    if (keyId) await withTenant(owner, () => updateApiKey(keyId, { isActive: false, revokedAt: new Date().toISOString() }));
    if (process.env.LIVE_PROVIDER_REPORT) writeFileSync(process.env.LIVE_PROVIDER_REPORT, JSON.stringify(report, null, 2));
  });

  it("lists at least one chat model", async () => {
    // The listing names a provider by its public prefix: uiAlias when set (`xmtp`), else alias.
    const prefixes = new Set([providerId, entry?.alias, entry?.uiAlias].filter(Boolean));
    const data = (await withTenant(owner, () => buildModelsList(["llm"], {}))) as Array<{ id: string; owned_by?: string }>;
    const mine = data.filter((m) => prefixes.has(m.owned_by) || prefixes.has(m.id.split("/")[0]));
    report.models = mine.length;
    expect(mine.length, `no models listed for ${[...prefixes].join("/")}`).toBeGreaterThan(0);
    if (!model) model = mine[0].id;
    report.model = model;
  }, CALL_TIMEOUT_MS);

  it("answers a plain chat", async () => {
    const res = await chat({ stream: false, messages: [{ role: "user", content: "Reply with just: ok" }] });
    report.chat = { status: res.status, sample: res.raw.slice(0, 300) };
    expect(res.status, res.raw.slice(0, 500)).toBe(200);
    const body = JSON.parse(res.raw);
    const message = body?.choices?.[0]?.message;
    expect(`${message?.content ?? ""}${message?.reasoning_content ?? ""}`.trim().length, res.raw.slice(0, 500)).toBeGreaterThan(0);
  }, CALL_TIMEOUT_MS);

  it("streams content deltas", async () => {
    const res = await chat({ stream: true, messages: [{ role: "user", content: "Count from 1 to 5." }] });
    let text = "";
    for (const line of res.raw.split("\n")) {
      if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
      try {
        const delta = JSON.parse(line.slice(5)).choices?.[0]?.delta;
        text += `${delta?.content ?? ""}${delta?.reasoning_content ?? ""}`;
      } catch { /* keep-alive or partial line */ }
    }
    report.stream = { status: res.status, chars: text.length, sample: res.raw.slice(0, 300) };
    expect(res.status, res.raw.slice(0, 500)).toBe(200);
    expect(text.trim().length, res.raw.slice(0, 500)).toBeGreaterThan(0);
  }, CALL_TIMEOUT_MS);

  it.skipIf(!toolCalling)("calls a tool when asked to", async () => {
    const res = await chat({
      stream: false,
      messages: [{ role: "user", content: "What is the weather in Paris? Use the get_weather tool." }],
      tools: [{
        type: "function",
        function: {
          name: "get_weather",
          description: "Get the current weather for a city",
          parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        },
      }],
      tool_choice: "auto",
    });
    report.tools = { status: res.status, sample: res.raw.slice(0, 300) };
    expect(res.status, res.raw.slice(0, 500)).toBe(200);
    const calls = JSON.parse(res.raw)?.choices?.[0]?.message?.tool_calls;
    expect(Array.isArray(calls) && calls.length > 0, res.raw.slice(0, 500)).toBe(true);
  }, CALL_TIMEOUT_MS);
});
