import { afterEach, describe, expect, it, vi } from "vitest";
import { ZaiWebExecutor } from "@/server/llm-gateway/engine/executors/zai-web";

const token = ["h", Buffer.from(JSON.stringify({ id: "u1" })).toString("base64url"), "s"].join(".");
const credentials = { apiKey: JSON.stringify({ token, captcha_verify_param: "captcha" }) };
const body = { model: "glm-5.3", messages: [{ role: "user", content: "oi" }] };

const sse = (...frames: Record<string, unknown>[]) =>
  new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(""), { status: 200 });

const CAPTCHA_FRAME = { error: { detail: "Captcha verification failed. Please verify again and retry." } };
const ANSWER_FRAME = { type: "chat:completion", data: { phase: "answer", delta_content: "tudo bem", done: true } };

/** Answers the frontend probe and chat creation, and the completions in order. */
function upstream(...completions: Response[]) {
  const queue = [...completions];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://chat.z.ai/") return new Response("<html></html>", { status: 200 });
    if (url.includes("/chats/new")) return new Response(JSON.stringify({ id: `chat-${queue.length}` }), { status: 200 });
    return queue.shift() ?? sse(ANSWER_FRAME);
  });
}

const completionCalls = (mock: ReturnType<typeof upstream>) =>
  mock.mock.calls.filter(([input]) => String(input).includes("/chat/completions")).length;

afterEach(() => vi.restoreAllMocks());

describe("zai-web captcha retry", () => {
  it("retries once when the captcha frame is the first thing upstream says", async () => {
    const fetchMock = upstream(sse(CAPTCHA_FRAME), sse(ANSWER_FRAME));

    const { response } = await new ZaiWebExecutor().execute({
      model: "glm-5.3", body, stream: false, credentials,
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.choices[0].message.content).toBe("tudo bem");
    expect(completionCalls(fetchMock)).toBe(2);
  });

  it("gives up after one retry and reports the captcha failure", async () => {
    const fetchMock = upstream(sse(CAPTCHA_FRAME), sse(CAPTCHA_FRAME));

    const { response } = await new ZaiWebExecutor().execute({
      model: "glm-5.3", body, stream: false, credentials,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await response.json())).toMatch(/aptcha/);
    expect(completionCalls(fetchMock)).toBe(2);
  });

  it("keeps a streamed answer that arrives after a retried captcha failure", async () => {
    upstream(sse(CAPTCHA_FRAME), sse(ANSWER_FRAME));

    const { response } = await new ZaiWebExecutor().execute({
      model: "glm-5.3", body, stream: true, credentials,
    });

    const text = await response.text();
    expect(text).toContain("tudo bem");
    expect(text).not.toMatch(/aptcha/);
  });

  it("does not retry a non-captcha upstream error", async () => {
    const fetchMock = upstream(sse({ error: "quota exceeded" }));

    const { response } = await new ZaiWebExecutor().execute({
      model: "glm-5.3", body, stream: false, credentials,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(completionCalls(fetchMock)).toBe(1);
  });
});
