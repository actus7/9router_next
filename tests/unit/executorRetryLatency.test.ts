import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.hoisted(() => vi.fn());

vi.mock("@/server/llm-gateway/engine/utils/proxyFetch", () => ({ proxyAwareFetch }));

import { BaseExecutor } from "@/server/llm-gateway/engine/executors/base";

class Probe extends BaseExecutor {
  constructor() {
    super("probe", { baseUrl: "https://example.test", timeoutMs: 20 });
  }
  buildUrl() {
    return "https://example.test/v1/chat/completions";
  }
}

const run = () =>
  new Probe().execute({
    model: "m",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    credentials: {},
  } as never);

// Um upstream que não devolve headers ficava preso 4× o connect timeout
// (60s cada, +3s de espera) antes de a próxima conta ser tentada — o loop de
// contas em chat.ts é quem faz o fallback, repetir a mesma URL só atrasa.
describe("latência de retry no executor", () => {
  beforeEach(() => { proxyAwareFetch.mockReset(); });

  it("connect timeout não é repetido na mesma URL", async () => {
    proxyAwareFetch.mockImplementation((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      }));

    await expect(run()).rejects.toThrow();
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("502 rápido é repetido no máximo uma vez, sem esperar segundos", async () => {
    proxyAwareFetch.mockResolvedValue(new Response("bad gateway", { status: 502 }));

    const t0 = Date.now();
    const { response } = await run();
    expect(response.status).toBe(502);
    expect(proxyAwareFetch.mock.calls.length).toBeLessThanOrEqual(2);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
