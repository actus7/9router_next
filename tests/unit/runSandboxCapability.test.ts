import { describe, expect, it } from "vitest";
import { runSandboxCapability } from "@/server/plugin-core/sandbox/runSandboxCapability";

describe("runSandboxCapability", () => {
  it("executes a registered sandbox tool", async () => {
    const result = await runSandboxCapability({
      source: `
        registerTool("echo", (input) => ({ message: input.text }));
      `,
      toolName: "echo",
      input: { text: "hello" },
    });
    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ message: "hello" });
  });

  it("rejects empty source", async () => {
    const result = await runSandboxCapability({ source: "  ", input: {} });
    expect(result.ok).toBe(false);
  });

  it("rejects source larger than the compile budget", async () => {
    const result = await runSandboxCapability({
      source: `// ${"x".repeat(64 * 1024)}`,
      input: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("exceeds");
  });

  it("keeps a runaway loop inside the interrupt budget", async () => {
    const result = await runSandboxCapability({
      source: `registerTool("spin", () => { while (true) {} });`,
      toolName: "spin",
      input: {},
      timeoutMs: 50,
    });
    expect(result.ok).toBe(false);
  });
});
