import { afterEach, describe, expect, it } from "vitest";
import { buildOnStreamComplete } from "@/server/llm-gateway/engine/handlers/chatCore/streamingHandler";
import { setModelStatsStore, setPerfKey, type AttemptDatum } from "@/server/llm-gateway/engine/host/modelStats";

afterEach(() => setModelStatsStore(null));

function complete(body: Record<string, unknown>, completionTokens: number, ttftAgoMs: number) {
  const recorded: AttemptDatum[] = [];
  setModelStatsStore({ record: (d) => recorded.push(d), read: async () => new Map() });
  const start = Date.now() - ttftAgoMs - 1_000;
  const { onStreamComplete } = buildOnStreamComplete({
    provider: "p", model: "m", connectionId: "c", apiKey: undefined, requestStartTime: start, body, stream: true,
    finalBody: undefined, translatedBody: {}, clientRawRequest: undefined, pxpipe: null, reqTag: "t", log: undefined,
  });
  onStreamComplete({ content: "x" }, { prompt_tokens: 10, completion_tokens: completionTokens }, Date.now() - ttftAgoMs);
  return recorded;
}

describe("generation speed is measured when a combo stream ends", () => {
  it("records tokens and generation time under the attempt's model key", () => {
    const body: Record<string, unknown> = {};
    setPerfKey(body, "xmtp/mimo-pro|large");
    const [datum] = complete(body, 500, 5_000);
    expect(datum).toMatchObject({ modelKey: "xmtp/mimo-pro|large", outcome: "throughput", genTokens: 500 });
    expect(datum.genMs).toBeGreaterThanOrEqual(4_900);
  });

  it("records nothing outside a combo, or for an answer too short to say anything", () => {
    expect(complete({}, 500, 5_000)).toEqual([]);
    const body: Record<string, unknown> = {};
    setPerfKey(body, "a/m");
    expect(complete(body, 5, 5_000)).toEqual([]);
  });
});
