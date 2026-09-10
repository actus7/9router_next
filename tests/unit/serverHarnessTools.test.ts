import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The harness's own tools in the worker.
 *
 * They went through `/api/harness/*`, and every one of those routes begins with
 * `requireDashboardAccess()` — a worker has no dashboard session, so the HTTP
 * shape was not available to it at all. Calling the domain underneath is what
 * makes them reachable.
 *
 * The property that matters most: the approval gate has to survive the move.
 * An agent write that got quieter by changing which side of the wire it ran on
 * would be a governance regression dressed up as a refactor.
 */

const writeSkill = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => ({ pending: true, pendingId: "pw_1" })));
const applyMemoryWrite = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => ({ ok: true, pending: true, pendingId: "pw_2" })));
const applyPluginToggle = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => ({ ok: true, pending: true })));
const proposeHarnessCapability = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => ({ ok: true, pendingId: "pw_3" })));
const reloadSkillTree = vi.hoisted(() => vi.fn(async () => ({ revision: 1, skills: [] as Array<Record<string, unknown>>, diagnostics: [] })));
const listAgentSkillFiles = vi.hoisted(() => vi.fn(async (_id: string) => [] as Array<{ filePath: string; content: string }>));
const searchPastSessionMessages = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => [] as unknown[]));

vi.mock("@/server/harness/skills/writeSkill", () => ({ writeSkill }));
vi.mock("@/server/harness/memory/applyMemoryWrite", () => ({ applyMemoryWrite }));
vi.mock("@/server/harness/governance/applyPluginWrite", () => ({ applyPluginToggle, proposeHarnessCapability }));
vi.mock("@/server/harness/skills/context", () => ({ reloadSkillTree }));
vi.mock("@/lib/db/repos/agentSkillFilesRepo", () => ({ listAgentSkillFiles }));
vi.mock("@/lib/db/repos/harnessMessageIndexRepo", () => ({ searchPastSessionMessages }));

import {
  executeHarnessToolServerSide,
  type HarnessToolContext,
} from "@/server/harness/tools/serverHarnessTools";

const context: HarnessToolContext = { sessionId: "s1" };

async function run(name: string, args: Record<string, unknown> = {}, ctx: HarnessToolContext = context) {
  const raw = await executeHarnessToolServerSide(name, args, ctx);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => vi.clearAllMocks());

describe("the approval gate survives the move", () => {
  it("writes a skill as the agent, so it is queued not applied", async () => {
    const result = await run("create_skill", { name: "deploy", description: "how", body: "steps" });

    expect(writeSkill.mock.calls[0]?.[0]).toMatchObject({ initiator: "agent", action: "create" });
    expect(result).toMatchObject({ ok: true, pending: true, pendingId: "pw_1" });
  });

  it("writes memory as the agent", async () => {
    const result = await run("memory_add", { scope: "agent", content: "remember" });

    expect(applyMemoryWrite.mock.calls[0]?.[0]).toMatchObject({ source: "agent", action: "add" });
    expect(result).toMatchObject({ ok: true, pending: true });
  });

  it("toggles a plugin as the agent", async () => {
    await run("toggle_plugin", { plugin_id: "tool-memory", enabled: false });

    expect(applyPluginToggle.mock.calls[0]?.[0]).toMatchObject({ source: "agent" });
  });

  it("proposes a capability through the domain", async () => {
    const result = await run("propose_harness_capability", { title: "t", description: "d", tool_name: "x" });

    expect(proposeHarnessCapability).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
  });
});

describe("reads keep their session scope", () => {
  it("refuses a skill the session has not enabled", async () => {
    const result = await run("load_skill", { name: "deploy" }, {
      ...context,
      enabledSkillIds: new Set(["other"]),
    });

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/not enabled/i);
    expect(reloadSkillTree).not.toHaveBeenCalled();
  });

  it("returns a composed skill with its file list", async () => {
    reloadSkillTree.mockResolvedValue({ revision: 1, skills: [{ id: "deploy", description: "how", body: "steps", enabled: true }], diagnostics: [] });
    listAgentSkillFiles.mockResolvedValue([{ filePath: "notes.md", content: "x" }]);

    const result = await run("load_skill", { name: "deploy" });

    expect(result).toMatchObject({ ok: true, name: "deploy", body: "steps", files: ["notes.md"] });
  });

  it("reads one skill file by path", async () => {
    reloadSkillTree.mockResolvedValue({ revision: 1, skills: [{ id: "deploy", body: "steps" }], diagnostics: [] });
    listAgentSkillFiles.mockResolvedValue([{ filePath: "Notes.md", content: "file body" }]);

    const result = await run("load_skill_file", { name: "deploy", path: "notes.md" });

    expect(result).toMatchObject({ ok: true, content: "file body" });
  });

  it("excludes the current conversation from a past-session search", async () => {
    searchPastSessionMessages.mockResolvedValue([{ sessionId: "s2" }]);

    const result = await run("search_past_sessions", { query: "deploy" });

    expect(searchPastSessionMessages.mock.calls[0]?.[0]).toMatchObject({ excludeSessionId: "s1" });
    expect(result).toMatchObject({ ok: true });
  });
});

describe("validation", () => {
  it("declines a tool it does not own", async () => {
    expect(await executeHarnessToolServerSide("web_search", {}, context)).toBeNull();
  });

  it("rejects a memory add with no scope", async () => {
    const result = await run("memory_add", { content: "x" });

    expect(result.ok).toBe(false);
    expect(applyMemoryWrite).not.toHaveBeenCalled();
  });

  it("will not patch a bundled skill", async () => {
    reloadSkillTree.mockResolvedValue({ revision: 1, skills: [{ id: "deploy", body: "steps", bundled: true }], diagnostics: [] });

    const result = await run("patch_skill", { name: "deploy", patch: "more" });

    expect(result.ok).toBe(false);
    expect(writeSkill).not.toHaveBeenCalled();
  });
});
