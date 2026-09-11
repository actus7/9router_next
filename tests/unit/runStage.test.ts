import { describe, expect, it } from "vitest";

import { ANSWERING_STAGE, runStageFor } from "@/server/harness/tools/runStage";

/**
 * The stage is what the history list says a conversation is doing. It is
 * coarse on purpose — the sidebar polls every 8s, so a label naming the exact
 * tool would routinely describe one that already finished.
 */
describe("runStageFor", () => {
  it("groups the tools that mean the same thing to a reader", () => {
    expect(runStageFor("web_search")).toBe(runStageFor("web_fetch"));
    expect(runStageFor("create_skill")).toBe(runStageFor("patch_skill"));
    expect(runStageFor("memory_add")).toBe(runStageFor("memory_remove"));
  });

  it("keeps the slow ones apart, which is the whole point", () => {
    expect(runStageFor("generate_video")).not.toBe(runStageFor("generate_image"));
    expect(runStageFor("generate_image")).not.toBe(runStageFor("web_search"));
  });

  it("does not put a third party's tool name on our screen", () => {
    // An MCP name comes from someone else's server. That it is external is the
    // part worth saying; the name is not ours to show.
    expect(runStageFor("mcp_acme_charge_card")).not.toContain("acme");
    expect(runStageFor("mcp_acme_charge_card")).toBe(runStageFor("mcp_other_thing"));
  });

  it("has something to say about a tool it has never heard of", () => {
    expect(runStageFor("some_future_tool")).toBeTruthy();
    expect(runStageFor("some_future_tool")).not.toBe(ANSWERING_STAGE);
  });
});
