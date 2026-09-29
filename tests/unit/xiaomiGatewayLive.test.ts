import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The gateway engine against a real provider, in every client dialect.
 *
 * Xiaomi's Token Plan speaks both OpenAI (`/v1`) and Anthropic (`/anthropic/v1`),
 * which is what makes it useful here: one key exercises the translation in
 * both directions — an OpenAI client on an Anthropic upstream and the reverse —
 * plus passthrough, streaming, tool calling and the Responses API.
 *
 * Only the usage accounting is stubbed (it writes to the database, and is not
 * what this proves). Off by default: it spends quota.
 *
 *   LIVE_XIAOMI=1 npx vitest run tests/unit/xiaomiGatewayLive.test.ts
 *   (reads TMP_KEY from .env; LIVE_XIAOMI_MODEL defaults to mimo-v2.6-pro)
 */
vi.mock("@/server/llm-gateway/engine/host/usage", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => undefined),
  saveRequestDetail: vi.fn(async () => undefined),
  saveRequestUsage: vi.fn(async () => undefined),
}));

const live = process.env.LIVE_XIAOMI === "1" && !!process.env.TMP_KEY;
const MODEL = process.env.LIVE_XIAOMI_MODEL || "mimo-v2.6-pro";
const BASE = "https://token-plan-sgp.xiaomimimo.com";

const UPSTREAMS = {
  openai: { provider: "openai-compatible-xiaomi-live", baseUrl: `${BASE}/v1` },
  anthropic: { provider: "anthropic-compatible-xiaomi-live", baseUrl: `${BASE}/anthropic/v1` },
} as const;

type Upstream = keyof typeof UPSTREAMS;

const WEATHER_TOOL_OPENAI = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Current weather for a city",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
};
const WEATHER_TOOL_CLAUDE = {
  name: "get_weather",
  description: "Current weather for a city",
  input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
};

let handleChatCore: typeof import("@/server/llm-gateway/engine/handlers/chatCore").handleChatCore;
let withTenant: typeof import("@/lib/db/tenant").withTenant;

beforeAll(async () => {
  if (!live) return;
  ({ handleChatCore } = await import("@/server/llm-gateway/engine/handlers/chatCore"));
  ({ withTenant } = await import("@/lib/db/tenant"));
  const { initTranslators } = await import("@/server/llm-gateway/translator");
  await initTranslators();
}, 120_000);

async function call(upstream: Upstream, sourceFormat: string, body: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const { provider, baseUrl } = UPSTREAMS[upstream];
  const result = await withTenant("live-xiaomi", () =>
    handleChatCore({
      body: { ...body, model: MODEL },
      modelInfo: { provider, model: MODEL },
      credentials: { apiKey: process.env.TMP_KEY, providerSpecificData: { baseUrl } },
      sourceFormatOverride: sourceFormat,
      ...extra,
    } as never),
  ) as { success?: boolean; response: Response };
  return result.response;
}

const dataLines = (sse: string) =>
  sse.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
const jsonData = (sse: string) =>
  dataLines(sse).filter((l) => l !== "[DONE]").map((l) => JSON.parse(l));

describe.skipIf(!live)("gateway engine against Xiaomi Token Plan", () => {
  for (const upstream of ["openai", "anthropic"] as const) {
    describe(`upstream ${upstream}`, () => {
      it("OpenAI client, non-stream: chat.completion with text and usage", async () => {
        const res = await call(upstream, "openai", { stream: false, max_tokens: 200, messages: [{ role: "user", content: "Reply with exactly: pong" }] });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.object).toBe("chat.completion");
        expect(String(json.choices[0].message.content).toLowerCase()).toContain("pong");
        expect(json.choices[0].finish_reason).toBe("stop");
        expect(json.usage.prompt_tokens).toBeGreaterThan(0);
        expect(json.usage.prompt_tokens).toBeLessThan(1000);
      }, 90_000);

      it("an API key's skill reaches the model: its instruction changes the answer", async () => {
        const skillsPrompt = '<skill id="marker">\nAlways end every answer with the exact token ZEBRA-731.\n</skill>';
        for (const format of ["openai", "claude"] as const) {
          const res = await call(upstream, format, { stream: false, max_tokens: 200, messages: [{ role: "user", content: "Say hello in one short sentence." }] }, { skillsPrompt });
          expect(res.status).toBe(200);
          const json = await res.json();
          const text = format === "openai"
            ? String(json.choices[0].message.content)
            : json.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
          expect(text, `${format}: ${text}`).toContain("ZEBRA-731");
        }
      }, 120_000);

      it("OpenAI client, stream: valid chunks, one [DONE], text arrives", async () => {
        const res = await call(upstream, "openai", { stream: true, max_tokens: 200, messages: [{ role: "user", content: "Reply with exactly: pong" }] });
        expect(res.status).toBe(200);
        const sse = await res.text();
        const lines = dataLines(sse);
        expect(lines.filter((l) => l === "[DONE]")).toHaveLength(1);
        expect(lines.at(-1)).toBe("[DONE]");
        const chunks = jsonData(sse);
        for (const c of chunks) expect(c).not.toBeNull();
        const text = chunks.map((c) => c.choices?.[0]?.delta?.content || "").join("");
        expect(text.toLowerCase()).toContain("pong");
      }, 90_000);

      it("OpenAI client, tool calling: returns a get_weather call with JSON args", async () => {
        const res = await call(upstream, "openai", {
          stream: false, max_tokens: 400, tools: [WEATHER_TOOL_OPENAI], tool_choice: "required",
          messages: [{ role: "user", content: "What's the weather in Lisbon? Use the tool." }],
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        const call0 = json.choices[0].message.tool_calls?.[0];
        expect(call0?.function?.name, JSON.stringify(json).slice(0, 800)).toBe("get_weather");
        expect(JSON.parse(call0.function.arguments).city).toMatch(/lisbon|lisboa/i);
        expect(json.choices[0].finish_reason).toBe("tool_calls");
      }, 90_000);

      it("Anthropic client, non-stream: message with text block and end_turn", async () => {
        const res = await call(upstream, "claude", { stream: false, max_tokens: 200, messages: [{ role: "user", content: "Reply with exactly: pong" }] });
        expect(res.status).toBe(200);
        const msg = await res.json();
        expect(msg.type).toBe("message");
        const text = msg.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
        expect(text.toLowerCase()).toContain("pong");
        expect(msg.stop_reason).toBe("end_turn");
      }, 90_000);

      it("Anthropic client, stream: event order ends in a single message_stop", async () => {
        const res = await call(upstream, "claude", { stream: true, max_tokens: 200, messages: [{ role: "user", content: "Reply with exactly: pong" }] });
        expect(res.status).toBe(200);
        const sse = await res.text();
        expect(dataLines(sse)).not.toContain("[DONE]");
        const events = jsonData(sse).map((e) => e.type);
        expect(events[0]).toBe("message_start");
        expect(events.filter((t) => t === "message_stop")).toHaveLength(1);
        expect(events.at(-1)).toBe("message_stop");
        const text = jsonData(sse).filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join("");
        expect(text.toLowerCase()).toContain("pong");
      }, 90_000);

      it("Anthropic client, tool calling: tool_use block with parsed input", async () => {
        const res = await call(upstream, "claude", {
          stream: false, max_tokens: 400, tools: [WEATHER_TOOL_CLAUDE], tool_choice: { type: "any" },
          messages: [{ role: "user", content: "What's the weather in Lisbon? Use the tool." }],
        });
        expect(res.status).toBe(200);
        const msg = await res.json();
        const toolUse = msg.content.find((b: { type: string }) => b.type === "tool_use");
        expect(toolUse?.name, JSON.stringify(msg).slice(0, 800)).toBe("get_weather");
        expect(String(toolUse.input.city)).toMatch(/lisbon|lisboa/i);
        expect(msg.stop_reason).toBe("tool_use");
      }, 90_000);

      it("Responses client, stream: completed carries output and usage", async () => {
        const res = await call(upstream, "openai-responses", { stream: true, max_output_tokens: 200, input: [{ role: "user", content: "Reply with exactly: pong" }] });
        expect(res.status).toBe(200);
        const events = jsonData(await res.text());
        const completed = events.find((e) => e.type === "response.completed");
        expect(completed).toBeDefined();
        const output = completed.response.output as Array<{ type: string; content?: Array<{ text: string }> }>;
        const text = output.filter((o) => o.type === "message").flatMap((o) => o.content || []).map((c) => c.text).join("");
        expect(text.toLowerCase()).toContain("pong");
        expect(new Set(events.filter((e) => e.type === "response.output_item.added").map((e) => e.output_index)).size)
          .toBe(events.filter((e) => e.type === "response.output_item.added").length);
      }, 90_000);
    });
  }

  it("Synapse answers 'oi' locally, never calling the provider", async () => {
    const res = await call("openai", "openai", { stream: false, messages: [{ role: "user", content: "oi" }] }, { synapseEnabled: true, synapseLevel: "lite" });
    expect(res.headers.get("X-ModelHub-Token-Savers")).toBe("synapse");
    const json = await res.json();
    expect(json.choices[0].message.content).toMatch(/olá|oi/i);
  }, 30_000);
});
