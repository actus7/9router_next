import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Memory only works when the Memory plugin is on" has to be the server's rule.
 *
 * It was the browser's: the worker took `body.tools` as the set the session
 * enabled, so anything that could post a run body could write to the account's
 * shared memory with the plugin switched off. The approval gate ("who asked?")
 * has had a regression test since it was fixed; the capability gate ("may this
 * conversation do that?") had never been stated anywhere but in a render.
 */

const getHarnessConversation = vi.hoisted(() => vi.fn());
const applyMemoryWrite = vi.hoisted(() => vi.fn());
const applyPluginToggle = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repos/harnessConversationsRepo", () => ({ getHarnessConversation }));
vi.mock("@/server/harness/memory/applyMemoryWrite", () => ({ applyMemoryWrite }));
vi.mock("@/server/harness/governance/applyPluginWrite", () => ({
  applyPluginToggle,
  proposeHarnessCapability: vi.fn(),
}));

import { executeHarnessToolServerSide } from "@/server/harness/tools/serverHarnessTools";

function conversation(pluginOverrides: Record<string, boolean>) {
  return { id: "S", agentPresetId: undefined, pluginOverrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  applyMemoryWrite.mockResolvedValue({ ok: true, entry: { id: "m1" } });
  applyPluginToggle.mockResolvedValue({ ok: true });
});

describe("the capability gate", () => {
  it("refuses a memory write from a conversation with the plugin off", async () => {
    getHarnessConversation.mockResolvedValue(conversation({ "tool-memory": false }));

    const result = await executeHarnessToolServerSide(
      "memory_add",
      { scope: "user", content: "mora em Panambi" },
      { sessionId: "S" },
    );

    expect(applyMemoryWrite).not.toHaveBeenCalled();
    expect(String(result)).toMatch(/tool-memory|plugin/i);
  });

  it("allows it when the conversation has the plugin on", async () => {
    getHarnessConversation.mockResolvedValue(conversation({ "tool-memory": true }));

    await executeHarnessToolServerSide(
      "memory_add",
      { scope: "user", content: "mora em Panambi" },
      { sessionId: "S" },
    );

    expect(applyMemoryWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: "add", source: "agent" }),
    );
  });

  it("refuses a plugin toggle from a conversation without governance", async () => {
    getHarnessConversation.mockResolvedValue(conversation({ "tool-harness-governance": false }));

    const result = await executeHarnessToolServerSide(
      "toggle_plugin",
      { plugin_id: "tool-memory", enabled: true },
      { sessionId: "S" },
    );

    expect(applyPluginToggle).not.toHaveBeenCalled();
    expect(String(result)).toMatch(/governance|plugin/i);
  });
});
