import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import { clearModelPenalties, getModelPenalty, getStickyModel } from "@/server/llm-gateway/engine/services/modelPenalty";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const ok = () => new Response("{}", { status: 200 });
const fail = (status: number) => new Response(JSON.stringify({ error: { message: "x" } }), { status });

function run(models: string[], answer: (m: string) => Response, extra: Record<string, unknown> = {}) {
  const tried: string[] = [];
  const promise = handleComboChat({
    body: {},
    models,
    handleSingleModel: async (_b, m) => { tried.push(m); return answer(m); },
    log,
    comboName: "dev",
    autoSwitch: false,
    ...extra,
  });
  return promise.then((res) => ({ res, tried }));
}

describe("combo penalties", () => {
  beforeEach(() => clearModelPenalties());

  it("records penalties even when not adaptive, without changing the order", async () => {
    await run(["a/m", "b/m"], (m) => (m === "a/m" ? fail(429) : ok()));
    expect(getModelPenalty("a/m")).toBe(3);
    const { tried } = await run(["a/m", "b/m"], () => ok());
    expect(tried).toEqual(["a/m"]);
  });

  it("does not penalize a request the model rightly refused (client error)", async () => {
    await run(["a/m", "b/m"], (m) => (m === "a/m" ? fail(400) : ok()));
    expect(getModelPenalty("a/m")).toBe(0);
  });

  it("does not double-count a model skipped by cooldown", async () => {
    const retryAfter = new Date(Date.now() + 60_000).toISOString();
    await run(["a/m", "b/m"], (m) =>
      m === "a/m" ? new Response(JSON.stringify({ error: { message: "locked" }, retryAfter }), { status: 429 }) : ok());
    expect(getModelPenalty("a/m")).toBe(0);
  });

  it("a success pays a point back", async () => {
    await run(["a/m", "b/m"], (m) => (m === "a/m" ? fail(429) : ok()));
    await run(["a/m", "b/m"], () => ok(), { adaptive: false });
    expect(getModelPenalty("a/m")).toBe(2);
  });

  it("adaptive combos try the penalized model later", async () => {
    await run(["a/m", "b/m", "c/m"], (m) => (m === "a/m" ? fail(429) : ok()));
    const { tried } = await run(["a/m", "b/m", "c/m"], () => ok(), { adaptive: true });
    expect(tried).toEqual(["b/m"]);
  });
});

describe("combo sticky after fallback", () => {
  beforeEach(() => clearModelPenalties());

  it("starts the next request of the conversation on the model that rescued it", async () => {
    await run(["a/m", "b/m"], (m) => (m === "a/m" ? fail(503) : ok()), { adaptive: true, sessionKey: "chat-1" });
    expect(getStickyModel("chat-1", "dev")).toBe("b/m");
    const { tried } = await run(["a/m", "b/m"], () => ok(), { adaptive: true, sessionKey: "chat-1" });
    expect(tried).toEqual(["b/m"]);
  });

  it("does not stick when the first choice answered", async () => {
    await run(["a/m", "b/m"], () => ok(), { adaptive: true, sessionKey: "chat-2" });
    expect(getStickyModel("chat-2", "dev")).toBeUndefined();
  });

  it("is inert for a non-adaptive combo", async () => {
    await run(["a/m", "b/m"], (m) => (m === "a/m" ? fail(503) : ok()), { sessionKey: "chat-3" });
    expect(getStickyModel("chat-3", "dev")).toBeUndefined();
  });
});
