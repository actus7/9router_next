import { describe, expect, it } from "vitest";

import {
  OPENCODE_FINGERPRINT_TOOLS,
  appendMissingFingerprintTools,
  applyEnvFingerprint,
  applyFingerprintTools,
  concealFingerprintToolNames,
  fingerprintToolKey,
  recordRenamedToolNames,
  restoreToolNames,
  retargetToolChoice,
  takeRenamedToolNames,
} from "@/server/llm-gateway/engine/utils/opencodeFingerprint";

type Rec = Record<string, unknown>;
const chatTool = (name: string, properties: Rec = {}) => ({ type: "function", function: { name, description: "", parameters: { type: "object", properties } } });
const flatTool = (name: string, properties: Rec = {}) => ({ type: "function", name, description: "", parameters: { type: "object", properties } });
const nameOf = (tool: Rec) => ((tool.function as Rec | undefined)?.name ?? tool.name) as string;
const fnOf = (tool: Rec) => (tool.function ?? tool) as Rec;

describe("fingerprintToolKey", () => {
  it("matches the v2 names exactly, case included", () => {
    expect(OPENCODE_FINGERPRINT_TOOLS).toEqual(["read", "shell"]);
    expect(fingerprintToolKey(" read ")).toBe("read");
    expect(fingerprintToolKey("shell")).toBe("shell");
    // Upstream accepts case variants beside the canonical tool, so they are not keys.
    expect(fingerprintToolKey("Read")).toBe("");
    expect(fingerprintToolKey("bash")).toBe("");
    expect(fingerprintToolKey(undefined)).toBe("");
  });
});

describe("concealFingerprintToolNames", () => {
  it("adopts OpenCode's definition in place when the caller's arguments fit", () => {
    const { tools, map } = concealFingerprintToolNames([chatTool("shell", { command: { type: "string" } })]);
    expect(map.size).toBe(0);
    expect(nameOf(tools[0])).toBe("shell");
    expect(String(fnOf(tools[0]).description)).toContain("Execute a shell command");
  });

  it("moves an incompatible caller tool to an alias and records it for restore", () => {
    const { tools, map } = concealFingerprintToolNames([chatTool("read", { file: { type: "string" } }), chatTool("read_client")]);
    expect(nameOf(tools[0])).toBe("read_client2");
    expect(map.get("read_client2")).toBe("read");
  });

  it("drops a duplicate declaration of the same fingerprint name", () => {
    const { tools } = concealFingerprintToolNames([chatTool("shell", { command: {} }), chatTool("shell", { command: {} })]);
    expect(tools).toHaveLength(1);
  });

  it("leaves other tools and case variants untouched", () => {
    const other = chatTool("Read");
    const { tools, map } = concealFingerprintToolNames([other, "junk"] as unknown[]);
    expect(tools[0]).toBe(other);
    expect(tools[1]).toBe("junk");
    expect(map.size).toBe(0);
  });
});

describe("appendMissingFingerprintTools", () => {
  it("appends read and shell in chat shape", () => {
    const tools: unknown[] = [];
    expect(appendMissingFingerprintTools(tools, false)).toEqual(["read", "shell"]);
    expect((tools as Rec[]).map(nameOf)).toEqual(["read", "shell"]);
    expect((tools[0] as Rec).function).toBeDefined();
  });

  it("appends in flat shape and skips names already declared", () => {
    const tools: unknown[] = [flatTool("shell")];
    expect(appendMissingFingerprintTools(tools, true)).toEqual(["read"]);
    expect((tools[1] as Rec).name).toBe("read");
  });
});

describe("retargetToolChoice", () => {
  it("points a forced choice at the alias of a concealed tool", () => {
    const body: Rec = { tool_choice: { type: "function", function: { name: "read" } } };
    retargetToolChoice(body, new Map([["read_client", "read"]]));
    expect(((body.tool_choice as Rec).function as Rec).name).toBe("read_client");
  });
});

describe("applyEnvFingerprint", () => {
  it("adds a system message carrying <env> to a chat body without one", () => {
    const body: Rec = { messages: [{ role: "user", content: "hi" }] };
    expect(applyEnvFingerprint(body, false)).toBe(true);
    const [system] = body.messages as Rec[];
    expect(system.role).toBe("system");
    expect(String(system.content)).toContain("<env>");
  });

  it("appends to the caller's own system prompt instead of replacing it", () => {
    const body: Rec = { messages: [{ role: "system", content: "You are X." }, { role: "user", content: "hi" }] };
    applyEnvFingerprint(body, false);
    const content = String((body.messages as Rec[])[0].content);
    expect(content.startsWith("You are X.")).toBe(true);
    expect(content).toContain("<env>");
  });

  it("uses instructions on Responses and system on Claude bodies", () => {
    const flat: Rec = { input: [] };
    applyEnvFingerprint(flat, true);
    expect(String(flat.instructions)).toContain("<env>");
    const claude: Rec = { messages: [] };
    applyEnvFingerprint(claude, false, { claude: true });
    expect(JSON.stringify(claude.system)).toContain("<env>");
    expect((claude.messages as unknown[]).length).toBe(0);
  });

  it("leaves a genuine OpenCode prompt alone", () => {
    const body: Rec = { messages: [{ role: "system", content: "<env>already</env>" }] };
    expect(applyEnvFingerprint(body, false)).toBe(false);
  });
});

describe("applyFingerprintTools", () => {
  it("sends both gates: the tools and the <env> marker", () => {
    const body: Rec = { messages: [{ role: "user", content: "hi" }] };
    applyFingerprintTools(body, false);
    expect((body.tools as Rec[]).map(nameOf)).toEqual(["read", "shell"]);
    expect(JSON.stringify(body.messages)).toContain("<env>");
    // Never "none": upstream answers it with 403.
    expect(body.tool_choice).toBeUndefined();
  });

  it("defaults tool_choice to auto on flat bodies", () => {
    const body: Rec = { input: [] };
    applyFingerprintTools(body, true);
    expect(body.tool_choice).toBe("auto");
  });

  it("aliases prior-turn calls to a concealed tool and records the rename on the body", () => {
    const body: Rec = {
      tools: [chatTool("read", { file: {} })],
      messages: [{ role: "assistant", tool_calls: [{ id: "c1", function: { name: "read", arguments: "{}" } }] }],
    };
    const map = applyFingerprintTools(body, false);
    expect(map.get("read_client")).toBe("read");
    expect(takeRenamedToolNames(body)).toBe(map);
    expect(JSON.stringify(body.messages)).toContain("read_client");
    recordRenamedToolNames({}, new Map([["a", "b"]]));
    expect(takeRenamedToolNames({})).toBeNull();
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
