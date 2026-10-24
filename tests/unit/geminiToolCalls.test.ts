import { describe, expect, it } from "vitest";

import { openaiToGeminiRequest } from "@/server/llm-gateway/engine/translator/request/openai-to-gemini";
import { cleanJSONSchemaForAntigravity } from "@/server/llm-gateway/engine/translator/formats/gemini";

type Part = { functionCall?: { id: string; name: string; args: unknown }; functionResponse?: { id: string; name: string; response: { result: unknown } } };
type Content = { role: string; parts: Part[] };

const call = (id: string, name: string, args = "{}") => ({ id, type: "function", function: { name, arguments: args } });
const answer = (id: string, content: string) => ({ role: "tool", tool_call_id: id, content });

function translate(messages: unknown[]): Content[] {
  const out = openaiToGeminiRequest("gemini-2.5-pro", { messages }, false) as { contents: Content[] };
  return out.contents;
}

const calls = (contents: Content[]) => contents.flatMap((c) => c.parts).filter((p) => p.functionCall).map((p) => p.functionCall!);
const responses = (contents: Content[]) => contents.flatMap((c) => c.parts).filter((p) => p.functionResponse).map((p) => p.functionResponse!);

// Gemini validates functionCall id uniqueness across the WHOLE history and answers
// 400 INVALID_ARGUMENT otherwise, but an OpenAI tool_call_id is only unique within its
// own assistant turn: a long agent session can reuse one in a later turn.
describe("Gemini request: duplicate tool_call_ids across turns", () => {
  const history = [
    { role: "user", content: "go" },
    { role: "assistant", content: null, tool_calls: [call("call_1", "read", "{\"p\":\"a\"}")] },
    answer("call_1", "{\"turn\":1}"),
    { role: "assistant", content: null, tool_calls: [call("call_1", "write", "{\"p\":\"b\"}")] },
    answer("call_1", "{\"turn\":2}"),
    { role: "user", content: "done?" },
  ];

  it("emits a different id for each functionCall", () => {
    const ids = calls(translate(history)).map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe("call_1");
  });

  it("answers each call with its own id, name and result", () => {
    const contents = translate(history);
    const c = calls(contents);
    const r = responses(contents);

    expect(r).toHaveLength(2);
    expect(r[0].id).toBe(c[0].id);
    expect(r[1].id).toBe(c[1].id);
    expect(r[0].name).toBe("read");
    expect(r[1].name).toBe("write");
    expect(JSON.stringify(r[0].response)).toContain("\"turn\":1");
    expect(JSON.stringify(r[1].response)).toContain("\"turn\":2");
  });

  it("does not collide with an id that already ends in a counter", () => {
    const messages = [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [call("x", "a")] },
      answer("x", "1"),
      { role: "assistant", content: null, tool_calls: [call("x-2", "b")] },
      answer("x-2", "2"),
      { role: "assistant", content: null, tool_calls: [call("x", "c")] },
      answer("x", "3"),
      { role: "user", content: "?" },
    ];
    const ids = calls(translate(messages)).map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("leaves already unique ids exactly as they were", () => {
    const messages = [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [call("call_a", "read"), call("call_b", "write")] },
      answer("call_a", "1"),
      answer("call_b", "2"),
      { role: "user", content: "?" },
    ];
    const contents = translate(messages);
    expect(calls(contents).map((c) => c.id)).toEqual(["call_a", "call_b"]);
    expect(responses(contents).map((r) => r.id)).toEqual(["call_a", "call_b"]);
  });
});

// A tool parameter literally named `properties` made ensureObjectType treat the
// `properties` map as if it were a schema node and stamp `type: "object"` into it,
// which Gemini then reads as a property called "type" whose definition is a string.
describe("Gemini tool schema: a parameter named `properties`", () => {
  it("does not inject a type into the properties map", () => {
    const schema = {
      type: "object",
      properties: {
        properties: { type: "string", description: "free-form properties" },
        name: { type: "string" },
      },
      required: ["properties"],
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema)) as { properties: Record<string, unknown> };

    expect(Object.keys(cleaned.properties).sort()).toEqual(["name", "properties"]);
    expect(cleaned.properties.properties).toMatchObject({ type: "string" });
  });

  it("still infers type object for a nested object schema that has properties but no type", () => {
    const schema = {
      type: "object",
      properties: { nested: { properties: { a: { type: "string" } } } },
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema)) as { properties: { nested: { type?: string } } };

    expect(cleaned.properties.nested.type).toBe("object");
  });
});
