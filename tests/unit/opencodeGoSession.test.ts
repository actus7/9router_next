import { describe, expect, it } from "vitest";
import { OpenCodeGoExecutor } from "@/server/llm-gateway/engine/executors/opencode-go";

/**
 * OpenCode Go answers 400 MissingSessionID without `x-opencode-session`.
 * Contract (opencode.ai/docs/go): stable session per conversation; native
 * sessions pass through when well-formed, anything else is translated into
 * `ses_` + 32 hex.
 */
const make = () => new OpenCodeGoExecutor();

describe("opencode-go x-opencode-session", () => {
  it("sends a translated stable session when the client sends none", () => {
    const ex = make();
    ex.transformRequest("kimi-k3", { model: "kimi-k3", messages: [{ role: "user", content: "hi" }] }, true, { apiKey: "k", connectionId: "conn-1" });
    const headers = ex.buildHeaders({ apiKey: "k", connectionId: "conn-1" }, true);
    expect(headers["x-opencode-session"]).toMatch(/^ses_[0-9a-f]{32}$/);
  });

  it("preserves a native session header case-insensitively", () => {
    const ex = make();
    const headers = ex.buildHeaders({ apiKey: "k", rawHeaders: { "X-OpenCode-Session": "cli-abc-123" } }, true);
    expect(headers["x-opencode-session"]).toBe("cli-abc-123");
  });

  it("translates an over-long native session into a valid one", () => {
    const ex = make();
    const headers = ex.buildHeaders({ apiKey: "k", rawHeaders: { "x-opencode-session": "x".repeat(257) } }, true);
    expect(headers["x-opencode-session"]).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(headers["x-opencode-session"]).not.toBe("x".repeat(257));
  });

  it("keeps one session per conversation", () => {
    const ex = make();
    const body = { model: "kimi-k3", messages: [{ role: "user", content: "same conversation" }] };
    ex.transformRequest("kimi-k3", body, true, { apiKey: "k", connectionId: "conn-1" });
    const first = ex.buildHeaders({ apiKey: "k", connectionId: "conn-1" }, true)["x-opencode-session"];
    ex.transformRequest("kimi-k3", body, true, { apiKey: "k", connectionId: "conn-1" });
    const second = ex.buildHeaders({ apiKey: "k", connectionId: "conn-1" }, true)["x-opencode-session"];
    expect(first).toBe(second);
    expect(first).toMatch(/^ses_[0-9a-f]{32}$/);
  });
});
