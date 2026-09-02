import { describe, expect, it } from "vitest";
import {
  buildSessionSystemPrompt,
  getEnabledRuntimeToolNames,
  getRuntimeToolDefinitions,
  MODELHUB_AGENT_CONTEXT,
  resolveSessionPlugins,
} from "@/shared/harness/agentPlugins";

describe("Harness agent plugin composition", () => {
  it("keeps Standard mode as the complete ModelHub capability composition", () => {
    const names = getEnabledRuntimeToolNames("standard");
    expect(names).toEqual(new Set(["web_search", "web_fetch", "generate_image", "text_to_speech", "generate_video", "delegate_task"]));
  });

  it("derives a preset's tool schema from its enabled plugins", () => {
    expect(getRuntimeToolDefinitions("research").map((definition) => definition.function.name))
      .toEqual(["web_search", "web_fetch", "delegate_task"]);
  });

  it("layers a session override over its selected preset", () => {
    const resolved = resolveSessionPlugins("minimal", { "tool-web-search": true, "agent-instructions": false });
    expect(resolved.map((plugin) => plugin.id)).toEqual(["persona", "tool-web-search"]);
  });

  it("grounds the agent in ModelHub's real plugin contracts", () => {
    expect(MODELHUB_AGENT_CONTEXT).toContain("ModelHub Chat Harness");
    expect(MODELHUB_AGENT_CONTEXT).toContain("HarnessPluginDefinition");
    expect(MODELHUB_AGENT_CONTEXT).toContain("CorePlugin");
    expect(MODELHUB_AGENT_CONTEXT).toContain("without claiming it was installed");
  });

  it("injects the ModelHub context into the real Standard session prompt", () => {
    const prompt = buildSessionSystemPrompt(
      "standard",
      undefined,
      "Responda em português.",
    );

    expect(prompt).toContain(MODELHUB_AGENT_CONTEXT);
    expect(prompt).toContain("Responda em português.");
    expect(buildSessionSystemPrompt("standard", { persona: false })).not.toContain(
      MODELHUB_AGENT_CONTEXT,
    );
  });
});
