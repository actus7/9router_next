import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The Synapse Loop's whole life cycle through the real gateway engine and a
 * real provider (Xiaomi Token Plan): observe → shadow → active → served
 * locally with no provider call → 👎 → back to the model.
 *
 * Persistence is an in-memory stand-in for synapseLoopRepo (the SQL itself is
 * covered by tenantIsolation and the repo's own shape); usage accounting is
 * stubbed. Everything else — eligibility, stream and JSON observation,
 * equivalence, promotion, the local answer — is the production path.
 *
 *   LIVE_XIAOMI=1 npx vitest run tests/unit/synapseLoopLive.test.ts   (TMP_KEY from .env)
 */
const live = process.env.LIVE_XIAOMI === "1" && !!process.env.TMP_KEY;
const MODEL = process.env.LIVE_XIAOMI_MODEL || "mimo-v2.6-pro";

vi.mock("@/server/llm-gateway/engine/host/usage", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => undefined),
  saveRequestDetail: vi.fn(async () => undefined),
  saveRequestUsage: vi.fn(async () => undefined),
}));

const pending = vi.hoisted(() => [] as Array<Promise<unknown>>);
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => { pending.push(p); } }));

const store = vi.hoisted(() => ({ obs: [] as Array<Record<string, unknown>>, caps: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/db/repos/synapseLoopRepo", () => {
  type Cap = Record<string, unknown> & { id: string; status: string; shadowRuns: number; shadowAgreements: number; served: number; rejections: number };
  const caps = store.caps as Cap[];
  return {
    insertObservation: async (o: Record<string, unknown>) => { store.obs.push({ ...o, createdAt: new Date().toISOString() }); },
    listObservations: async (key: string, ph: string) => store.obs.filter((o) => o.key === key && o.personaHash === ph).reverse(),
    pruneObservations: async () => undefined,
    getCapability: async (key: string, ph: string) => caps.find((c) => c.key === key && c.personaHash === ph) ?? null,
    listCapabilitiesByKey: async (key: string) => caps.filter((c) => c.key === key),
    createShadowCapability: async (c: Record<string, unknown>) => {
      if (caps.some((x) => x.key === c.key && x.personaHash === c.personaHash)) return;
      caps.push({ ...c, id: `cap${caps.length}`, status: "shadow", shadowRuns: 0, shadowAgreements: 0, served: 0, rejections: 0 } as Cap);
    },
    bumpCapability: async (id: string, p: Record<string, number | string>) => {
      const c = caps.find((x) => x.id === id)!;
      for (const k of ["shadowRuns", "shadowAgreements", "served", "rejections"] as const) c[k] += Number(p[k] ?? 0);
      if (p.status) c.status = String(p.status);
    },
    demoteToShadow: async (id: string) => {
      const c = caps.find((x) => x.id === id)!;
      Object.assign(c, { status: "shadow", shadowRuns: 0, shadowAgreements: 0, rejections: c.rejections + 1 });
    },
    insertSynapseEvent: async () => undefined,
  };
});

const QUESTION = "Qual é a capital da França? Responda apenas com o nome da cidade.";

let handleChatCore: typeof import("@/server/llm-gateway/engine/handlers/chatCore").handleChatCore;
let withTenant: typeof import("@/lib/db/tenant").withTenant;
let rejectLearned: typeof import("@/server/synapse/loop").rejectLearned;
let LOOP_LIMITS: typeof import("@/server/synapse/loop").LOOP_LIMITS;

beforeAll(async () => {
  if (!live) return;
  ({ handleChatCore } = await import("@/server/llm-gateway/engine/handlers/chatCore"));
  ({ withTenant } = await import("@/lib/db/tenant"));
  ({ rejectLearned, LOOP_LIMITS } = await import("@/server/synapse/loop"));
  const { initTranslators } = await import("@/server/llm-gateway/translator");
  await initTranslators();
}, 120_000);

async function ask(stream: boolean) {
  const res = await withTenant("live-loop", () =>
    handleChatCore({
      body: { model: MODEL, stream, max_tokens: 300, messages: [{ role: "user", content: QUESTION }] },
      modelInfo: { provider: "openai-compatible-xiaomi-live", model: MODEL },
      credentials: { apiKey: process.env.TMP_KEY, providerSpecificData: { baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1" } },
      sourceFormatOverride: "openai",
      synapseEnabled: true,
      synapseLearningEnabled: true,
      synapseLearningUseJev: false,
    } as never),
  ) as { response: Response };
  const savers = res.response.headers.get("X-ModelHub-Token-Savers");
  await res.response.text(); // drain so the stream's completion (and the observation) runs
  await Promise.all(pending.splice(0));
  return { local: savers === "synapse" };
}

describe.skipIf(!live)("Synapse Loop, live", () => {
  it("learns, proves, serves locally, and steps back after a 👎", async () => {
    // Observe twice (stream and JSON), then prove it in shadow.
    expect((await ask(true)).local).toBe(false);
    expect((await ask(false)).local).toBe(false);
    expect(store.caps, `observations: ${JSON.stringify(store.obs.map((o) => o.answer))}`).toHaveLength(1);
    expect(store.caps[0].status).toBe("shadow");

    for (let i = 0; i < LOOP_LIMITS.minShadowRuns; i++) {
      expect((await ask(i % 2 === 0)).local).toBe(false);
    }
    expect(store.caps[0].status, JSON.stringify(store.caps[0])).toBe("active");

    // Now answered at the gateway: no provider call at all.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect((await ask(true)).local).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    // 👎 in the chat → out of use at once; the question goes to the model again.
    await withTenant("live-loop", () => rejectLearned(QUESTION));
    expect(store.caps[0].status).toBe("shadow");
    expect((await ask(true)).local).toBe(false);
  }, 900_000);
});
