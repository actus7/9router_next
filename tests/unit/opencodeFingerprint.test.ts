import { describe, expect, it } from "vitest";

import {
  OPENCODE_FINGERPRINT_TOOLS,
  appendMissingFingerprintTools,
  applyFingerprintTools,
  concealFingerprintToolNames,
  fingerprintToolKey,
  recordRenamedToolNames,
  restoreToolNames,
  retargetToolChoice,
  takeRenamedToolNames,
} from "@/server/llm-gateway/engine/utils/opencodeFingerprint";

const chatTool = (name: string) => ({ type: "function", function: { name, description: "", parameters: { type: "object", properties: {} } } });
const flatTool = (name: string) => ({ type: "function", name, description: "", parameters: { type: "object", properties: {} } });

describe("fingerprintToolKey", () => {
  it("maps any spelling of a quartet name to its canonical key", () => {
    expect(fingerprintToolKey("Bash")).toBe("bash");
    expect(fingerprintToolKey(" Grep ")).toBe("grep");
    expect(fingerprintToolKey("READ")).toBe("read");
    expect(fingerprintToolKey("glob")).toBe("glob");
  });

  it("returns empty string for non-fingerprint names and junk", () => {
    expect(fingerprintToolKey("WebFetch")).toBe("");
    expect(fingerprintToolKey("")).toBe("");
    expect(fingerprintToolKey(undefined)).toBe("");
    expect(fingerprintToolKey(42)).toBe("");
  });
});

describe("concealFingerprintToolNames", () => {
  it("renames chat-shape Bash to canonical bash and records the mapping", () => {
    const { tools, map } = concealFingerprintToolNames([chatTool("Bash"), chatTool("WebFetch")]);
    expect((tools[0] as { function: { name: string } }).function.name).toBe("bash");
    expect(map.get("bash")).toBe("Bash");
    expect((tools[1] as { function: { name: string } }).function.name).toBe("WebFetch");
    expect(map.has("WebFetch")).toBe(false);
  });

  it("renames flat-shape Grep to canonical grep", () => {
    const { tools, map } = concealFingerprintToolNames([flatTool("Grep")]);
    expect((tools[0] as { name: string }).name).toBe("grep");
    expect(map.get("grep")).toBe("Grep");
  });

  it("drops duplicates of the same canonical key (Bash + bash → one bash)", () => {
    const { tools, map } = concealFingerprintToolNames([chatTool("Bash"), chatTool("bash")]);
    expect(tools).toHaveLength(1);
    expect((tools[0] as { function: { name: string } }).function.name).toBe("bash");
    expect(map.get("bash")).toBe("Bash");
  });

  it("keeps the first canonical spelling when it arrives first (bash + Bash)", () => {
    const { tools, map } = concealFingerprintToolNames([chatTool("bash"), chatTool("Bash")]);
    expect(tools).toHaveLength(1);
    expect(map.size).toBe(0);
  });

  it("preserves non-fingerprint tools and non-object entries untouched", () => {
    const tools = concealFingerprintToolNames([chatTool("write"), null, "junk", flatTool("Read")]);
    expect(tools.tools[0]).toEqual(chatTool("write"));
    expect(tools.tools[1]).toBeNull();
    expect(tools.tools[2]).toBe("junk");
    expect(tools.map.get("read")).toBe("Read");
  });

  it("passes non-array/empty input through with an empty map", () => {
    expect(concealFingerprintToolNames(undefined).tools).toBeUndefined();
    expect(concealFingerprintToolNames([]).map.size).toBe(0);
  });
});

describe("appendMissingFingerprintTools", () => {
  it("appends the missing quartet in chat shape when flat is false", () => {
    const list = appendMissingFingerprintTools([chatTool("bash")], false) as Record<string, unknown>[];
    expect(list).toHaveLength(4);
    const names = list.map((t) => (t.function as { name: string }).name);
    expect(new Set(names)).toEqual(new Set(OPENCODE_FINGERPRINT_TOOLS));
  });

  it("appends the missing quartet in flat shape when flat is true", () => {
    const list = appendMissingFingerprintTools([], true) as Record<string, unknown>[];
    expect(list).toHaveLength(4);
    for (const tool of list) {
      expect(tool.type).toBe("function");
      expect(OPENCODE_FINGERPRINT_TOOLS).toContain(tool.name);
      expect(tool.function).toBeUndefined();
      expect(tool.parameters).toEqual({ type: "object", properties: {} });
    }
  });

  it("does not duplicate quartet members already present (any spelling)", () => {
    const list = appendMissingFingerprintTools([chatTool("Bash"), chatTool("grep")], false) as unknown[];
    expect(list).toHaveLength(4);
  });

  it("returns a fresh quartet list when input is not an array", () => {
    expect(appendMissingFingerprintTools(undefined, false)).toHaveLength(4);
  });
});

describe("retargetToolChoice", () => {
  const map = new Map([["bash", "Bash"]]);

  it("points a flat forced choice at the canonical name", () => {
    const body: Record<string, unknown> = { tool_choice: { type: "tool", name: "Bash" } };
    retargetToolChoice(body, map);
    expect(body.tool_choice).toEqual({ type: "tool", name: "bash" });
  });

  it("points a chat forced choice at the canonical name", () => {
    const body: Record<string, unknown> = { tool_choice: { type: "function", function: { name: "Bash" } } };
    retargetToolChoice(body, map);
    expect((body.tool_choice as { function: { name: string } }).function.name).toBe("bash");
  });

  it("leaves non-fingerprint choices and missing maps alone", () => {
    const body: Record<string, unknown> = { tool_choice: { type: "tool", name: "write" } };
    retargetToolChoice(body, map);
    expect(body.tool_choice).toEqual({ type: "tool", name: "write" });
    retargetToolChoice(body, new Map());
    expect(body.tool_choice).toEqual({ type: "tool", name: "write" });
    retargetToolChoice(null, map);
  });
});

describe("applyFingerprintTools", () => {
  it("always sends the quartet and defaults tool_choice to none without client tools", () => {
    const body: Record<string, unknown> = { messages: [] };
    const map = applyFingerprintTools(body, false);
    expect((body.tools as unknown[]).length).toBe(4);
    expect(body.tool_choice).toBe("none");
    expect(map.size).toBe(0);
  });

  it("defaults tool_choice to auto on flat bodies", () => {
    const body: Record<string, unknown> = {};
    applyFingerprintTools(body, true);
    expect(body.tool_choice).toBe("auto");
    expect((body.tools as Record<string, unknown>[])[0].name).toBe("bash");
  });

  it("keeps a client tool_choice and records renamed tools on the body", () => {
    const body: Record<string, unknown> = { tools: [chatTool("Bash")], tool_choice: "auto" };
    const map = applyFingerprintTools(body, false);
    expect(body.tool_choice).toBe("auto");
    expect(map.get("bash")).toBe("Bash");
    expect(takeRenamedToolNames(body)).toBe(map);
    recordRenamedToolNames({}, new Map([["a", "b"]]));
    expect(takeRenamedToolNames({})).toBeNull();
    expect(takeRenamedToolNames(null)).toBeNull();
  });

  it("is fail-open on non-object bodies", () => {
    expect(applyFingerprintTools(null, false).size).toBe(0);
  });
});

describe("restoreToolNames", () => {
  const map = new Map([["bash", "Bash"], ["read", "Read"]]);

  it("restores content_block_start tool_use names (Claude stream)", () => {
    const payload = { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "bash" } };
    const out = restoreToolNames(payload, map) as typeof payload;
    expect(out.content_block.name).toBe("Bash");
  });

  it("restores content[] tool_use blocks (Claude body)", () => {
    const payload = { content: [{ type: "tool_use", name: "read", input: {} }, { type: "text", text: "hi" }] };
    const out = restoreToolNames(payload, map) as typeof payload;
    expect((out.content[0] as { name: string }).name).toBe("Read");
  });

  it("restores choices delta and message tool_calls (OpenAI shapes)", () => {
    const payload = {
      choices: [
        { delta: { tool_calls: [{ index: 0, function: { name: "bash", arguments: "" } }] } },
        { message: { tool_calls: [{ id: "c1", function: { name: "read", arguments: "{}" } }] } },
      ],
    };
    const out = restoreToolNames(payload, map) as typeof payload;
    const [deltaChoice, messageChoice] = out.choices as unknown as [
      { delta: { tool_calls: [{ function: { name: string } }] } },
      { message: { tool_calls: [{ function: { name: string } }] } },
    ];
    expect(deltaChoice.delta.tool_calls[0].function.name).toBe("Bash");
    expect(messageChoice.message.tool_calls[0].function.name).toBe("Read");
  });

  it("restores output[] and item function_call names (Responses shapes)", () => {
    const payload = {
      output: [{ type: "function_call", name: "bash", arguments: "{}" }, { type: "message", role: "assistant" }],
      item: { type: "function_call", name: "read", arguments: "{}" },
    };
    const out = restoreToolNames(payload, map) as typeof payload;
    expect((out.output[0] as { name: string }).name).toBe("Bash");
    expect((out.item as { name: string }).name).toBe("Read");
  });

  it("returns the payload untouched when nothing matches or the map is empty", () => {
    const payload = { choices: [{ delta: { tool_calls: [{ function: { name: "web_fetch" } }] } }] };
    expect(restoreToolNames(payload, map)).toBe(payload);
    expect(restoreToolNames(payload, new Map())).toBe(payload);
    expect(restoreToolNames(payload, null)).toBe(payload);
  });

  it("recurses into arrays of payloads", () => {
    const chunks = [{ item: { type: "function_call", name: "bash" } }, { item: { type: "function_call", name: "read" } }];
    const out = restoreToolNames(chunks, map) as typeof chunks;
    expect((out[0].item as { name: string }).name).toBe("Bash");
    expect((out[1].item as { name: string }).name).toBe("Read");
  });
});
