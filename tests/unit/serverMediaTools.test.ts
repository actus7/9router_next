import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Media generation in the worker.
 *
 * The generation was always a gateway handler on this server; what lived in the
 * browser was the model fallback loop around it, plus two accidents of
 * environment — `btoa` for the audio bytes and an `AbortSignal` to bound the
 * video poll. Neither exists in a worker, so these are the parts that could not
 * simply be moved.
 */

const handleImageGeneration = vi.hoisted(() => vi.fn());
const handleTts = vi.hoisted(() => vi.fn());
const handleVideoCreate = vi.hoisted(() => vi.fn());
const handleVideoGet = vi.hoisted(() => vi.fn());
const buildModelsList = vi.hoisted(() => vi.fn(async (_kinds: string[]) => [] as unknown[]));

vi.mock("@/server/llm-gateway/media", () => ({
  handleImageGeneration,
  handleTts,
  handleVideoCreate,
  handleVideoGet,
}));
vi.mock("@/server/application/use-cases/http/v1/models/route", () => ({ buildModelsList }));

import {
  generateImageServerSide,
  generateVideoServerSide,
  textToSpeechServerSide,
} from "@/server/harness/tools/serverMediaTools";

const context = { authorization: null, deadline: Date.now() + 60_000 };

function ok(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  buildModelsList.mockResolvedValue([{ id: "provider/one" }, { id: "provider/two" }]);
});

describe("generate_image", () => {
  it("falls through to the next model when the first one fails", async () => {
    handleImageGeneration
      .mockResolvedValueOnce(new Response("nope", { status: 502 }))
      .mockResolvedValueOnce(ok({ data: [{ url: "https://example.test/a.png" }] }));

    const result = JSON.parse(await generateImageServerSide({ prompt: "a cat" }, context));

    expect(handleImageGeneration).toHaveBeenCalledTimes(2);
    expect(result.data[0].url).toBe("https://example.test/a.png");
  });

  it("reports every attempt when no provider answers", async () => {
    handleImageGeneration.mockImplementation(async () => new Response("nope", { status: 500 }));

    const result = JSON.parse(await generateImageServerSide({ prompt: "a cat" }, context));

    expect(result.ok).toBe(false);
    expect(result.attempts).toHaveLength(2);
  });

  it("refuses to start once the run is out of time", async () => {
    const result = JSON.parse(
      await generateImageServerSide({ prompt: "a cat" }, { ...context, deadline: Date.now() - 1 }),
    );

    expect(result.ok).toBe(false);
    expect(handleImageGeneration).not.toHaveBeenCalled();
  });
});

describe("text_to_speech", () => {
  it("encodes the audio with Buffer, not the browser's btoa", async () => {
    handleTts.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "audio/wav" } }),
    );

    const result = JSON.parse(await textToSpeechServerSide({ input: "hello" }, context));

    expect(result.ok).toBe(true);
    expect(result.audioUrl).toBe(`data:audio/wav;base64,${Buffer.from([1, 2, 3, 4]).toString("base64")}`);
  });

  it("refuses audio too large to ride the conversation", async () => {
    // The data URI lands in the message, is re-sent on every later turn, and is
    // now also written into the conversation row by the worker.
    handleTts.mockResolvedValue(new Response(new Uint8Array(3_000_000), { status: 200 }));

    const result = JSON.parse(await textToSpeechServerSide({ input: "hello" }, context));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/size limit/i);
  });
});

describe("generate_video", () => {
  it("polls the job it created until it completes", async () => {
    handleVideoCreate.mockResolvedValue(ok({ request_id: "job-1" }));
    handleVideoGet
      .mockResolvedValueOnce(ok({ status: "queued" }))
      .mockResolvedValueOnce(ok({ status: "completed", video: { url: "https://example.test/v.mp4" } }));

    const result = JSON.parse(await generateVideoServerSide({ prompt: "a cat" }, context));

    expect(result).toMatchObject({ ok: true, url: "https://example.test/v.mp4", requestId: "job-1" });
  });

  it("gives up at the run's deadline and hands back the job id", async () => {
    // Bounded by the run's budget, not by its own timeout: the platform kills
    // the invocation at `maxDuration` whatever this function thinks. The id
    // comes back so the job upstream is not simply lost.
    handleVideoCreate.mockResolvedValue(ok({ request_id: "job-2" }));
    handleVideoGet.mockImplementation(async () => ok({ status: "queued" }));

    const result = JSON.parse(
      await generateVideoServerSide({ prompt: "a cat" }, { ...context, deadline: Date.now() + 40 }),
    );

    expect(result).toMatchObject({ ok: false, requestId: "job-2" });
    expect(result.error).toMatch(/in time/i);
  });

  it("surfaces a job the provider failed", async () => {
    handleVideoCreate.mockResolvedValue(ok({ request_id: "job-3" }));
    handleVideoGet.mockImplementation(async () => ok({ status: "failed", error: "content policy" }));

    const result = JSON.parse(await generateVideoServerSide({ prompt: "a cat" }, context));

    expect(result).toMatchObject({ ok: false, error: "content policy" });
  });
});

describe("generate_image candidates", () => {
  it("asks real image models before a combo that happens to match the kind", async () => {
    buildModelsList.mockResolvedValue([
      { id: "chat", owned_by: "combo", kind: "smart" },
      { id: "vercel/bfl/flux-2-pro", owned_by: "vercel" },
    ]);
    handleImageGeneration.mockResolvedValue(ok({ data: [{ url: "https://img" }] }));

    await generateImageServerSide({ prompt: "a cat" }, context);

    const firstModel = JSON.parse(await (handleImageGeneration.mock.calls[0]![0] as Request).text()).model;
    expect(firstModel).toBe("vercel/bfl/flux-2-pro");
  });

  it("keeps the combo as a last resort", async () => {
    buildModelsList.mockResolvedValue([
      { id: "chat", owned_by: "combo" },
      { id: "gemini/flash-image", owned_by: "gemini" },
    ]);
    handleImageGeneration
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "denied" } }), { status: 403 }))
      .mockResolvedValueOnce(ok({ data: [{ url: "https://img" }] }));

    const result = JSON.parse(await generateImageServerSide({ prompt: "a cat" }, context));

    expect(result.data[0].url).toBe("https://img");
    const models = handleImageGeneration.mock.calls.map(([request]) => request as Request);
    expect(await Promise.all(models.map(async (r) => JSON.parse(await r.clone().text()).model))).toEqual(["gemini/flash-image", "chat"]);
  });

  it("reports the upstream's reason for each failed attempt", async () => {
    buildModelsList.mockResolvedValue([{ id: "gemini/flash-image", owned_by: "gemini" }]);
    handleImageGeneration.mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "Your project has been denied access. Please contact support." } }),
      { status: 403 },
    ));

    const result = JSON.parse(await generateImageServerSide({ prompt: "a cat" }, context));

    expect(result.attempts).toEqual([
      { provider: "gemini/flash-image", status: 403, error: "Your project has been denied access. Please contact support." },
    ]);
  });
});
