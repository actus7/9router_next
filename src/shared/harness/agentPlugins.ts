export interface RuntimeToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface HarnessPluginDefinition {
  id: string;
  title: string;
  description: string;
  module: string;
  kind: "context" | "mode" | "tool";
  tool?: RuntimeToolDefinition;
}

export interface AgentPresetDefinition {
  id: string;
  title: string;
  description: string;
  pluginIds: readonly string[];
}

export interface SessionMcpToolDefinition extends RuntimeToolDefinition {
  function: RuntimeToolDefinition["function"];
}

interface McpServerLike {
  id: string;
  enabled: boolean;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    runtimeName: string;
    enabled?: boolean;
  }>;
}

export const MODELHUB_AGENT_CONTEXT = [
  "You are operating inside the ModelHub Chat Harness.",
  "ModelHub is the product name; never present this application as an upstream or reference harness.",
  "Do not invent or import unpublished ModelHub or vendor-specific plugin SDK packages.",
  "ModelHub session capabilities are declared as HarnessPluginDefinition objects in the exact file src/shared/harness/agentPlugins.ts.",
  "Provider plugins implement CorePlugin under the exact directory src/server/plugin-core/plugins (spell plugin-core literally) and use the repository's cordis dependency; CorePlugin is declared in src/server/plugin-core/plugins/registry.ts.",
  "When asked to create or modify a plugin, target these real ModelHub contracts. If no filesystem editing tool is available, say so and provide a compatible patch without claiming it was installed.",
].join(" ");

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): RuntimeToolDefinition => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});

/**
 * The chat runtime's capability catalog. It is deliberately shared by the
 * settings UI and the request/execution path: a listed plugin is a capability
 * that can actually be composed into a session, never decorative metadata.
 */
export const HARNESS_PLUGINS: readonly HarnessPluginDefinition[] = [
  {
    id: "persona",
    title: "ModelHub context",
    description:
      "Identifies the product and exposes the real ModelHub plugin contracts to the agent.",
    module: "builtin:modelhub-context",
    kind: "context",
  },
  {
    id: "agent-instructions",
    title: "Agent instructions",
    description: "Adds the session system prompt to the model context.",
    module: "@modelhub/harness-agent-instructions",
    kind: "context",
  },
  {
    id: "plan-mode",
    title: "Plan mode",
    description:
      "Lets a session ask for an actionable plan without executing tools.",
    module: "@modelhub/harness-plan-mode",
    kind: "mode",
  },
  {
    id: "tool-web-search",
    title: "Web search",
    description: "Searches through a configured ModelHub search provider.",
    module: "@modelhub/harness-tool-web-search",
    kind: "tool",
    tool: tool(
      "web_search",
      "Search the web using the application's configured search provider. Use this for current information and cite the returned URLs.",
      {
        query: { type: "string", description: "Focused web search query." },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description: "Maximum number of results. Defaults to 5.",
        },
      },
      ["query"],
    ),
  },
  {
    id: "tool-web-fetch",
    title: "Web fetch",
    description:
      "Fetches and extracts a public web page through a configured provider.",
    module: "@modelhub/harness-tool-web-fetch",
    kind: "tool",
    tool: tool(
      "web_fetch",
      "Fetch and extract a public web page using the application's configured web-fetch provider.",
      {
        url: {
          type: "string",
          format: "uri",
          description: "Public HTTP(S) URL to fetch.",
        },
        max_characters: {
          type: "integer",
          minimum: 500,
          maximum: 30_000,
          description: "Maximum extracted characters. Defaults to 12,000.",
        },
      },
      ["url"],
    ),
  },
  {
    id: "tool-image-generation",
    title: "Image generation",
    description:
      "Generates images through a configured ModelHub image provider.",
    module: "@modelhub/harness-tool-image-generation",
    kind: "tool",
    tool: tool(
      "generate_image",
      "Generate an image from a text prompt using the application's configured image generation provider.",
      {
        prompt: {
          type: "string",
          description: "Description of the image to generate.",
        },
        model: { type: "string", description: "Optional provider/model id." },
      },
      ["prompt"],
    ),
  },
  {
    id: "tool-text-to-speech",
    title: "Text to speech",
    description:
      "Converts text to audio through a configured ModelHub TTS provider.",
    module: "@modelhub/harness-tool-text-to-speech",
    kind: "tool",
    tool: tool(
      "text_to_speech",
      "Convert text into spoken audio using the application's configured text-to-speech provider.",
      {
        input: {
          type: "string",
          description: "Text to synthesize into speech.",
        },
        voice: { type: "string", description: "Optional voice name." },
        model: { type: "string", description: "Optional provider/model id." },
      },
      ["input"],
    ),
  },
  {
    id: "tool-video-generation",
    title: "Video generation",
    description:
      "Generates a video through a configured ModelHub video provider.",
    module: "@modelhub/harness-tool-video-generation",
    kind: "tool",
    tool: tool(
      "generate_video",
      "Generate a short video from a text prompt using the application's configured video generation provider. This can take up to 90 seconds.",
      {
        prompt: {
          type: "string",
          description: "Description of the video to generate.",
        },
        model: { type: "string", description: "Optional provider/model id." },
      },
      ["prompt"],
    ),
  },
  {
    id: "tool-subagent",
    title: "Subagent",
    description:
      "Delegates one bounded research or analysis task to an isolated subagent.",
    module: "@modelhub/harness-tool-subagent",
    kind: "tool",
    tool: tool(
      "delegate_task",
      "Delegate one bounded research or analysis task to an ephemeral subagent. The subagent cannot call tools or delegate further.",
      {
        task: {
          type: "string",
          description: "Self-contained task, context, and expected output.",
        },
      },
      ["task"],
    ),
  },
];

export const AGENT_PRESETS: readonly AgentPresetDefinition[] = [
  {
    id: "standard",
    title: "Standard mode",
    description:
      "Full ModelHub agent with instructions, planning, web research, media generation, and bounded subagents.",
    pluginIds: HARNESS_PLUGINS.map((plugin) => plugin.id),
  },
  {
    id: "research",
    title: "Research mode",
    description:
      "Focused investigation agent with web search, web fetch, and bounded subagents.",
    pluginIds: [
      "persona",
      "agent-instructions",
      "plan-mode",
      "tool-web-search",
      "tool-web-fetch",
      "tool-subagent",
    ],
  },
  {
    id: "media",
    title: "Media mode",
    description:
      "Creative agent with image, audio, and video generation capabilities.",
    pluginIds: [
      "persona",
      "agent-instructions",
      "tool-image-generation",
      "tool-text-to-speech",
      "tool-video-generation",
    ],
  },
  {
    id: "minimal",
    title: "Minimal mode",
    description:
      "A focused conversational agent with only session instructions.",
    pluginIds: ["persona", "agent-instructions"],
  },
];

export const DEFAULT_AGENT_PRESET_ID = "standard";

export function getAgentPreset(id?: string): AgentPresetDefinition {
  return AGENT_PRESETS.find((preset) => preset.id === id) ?? AGENT_PRESETS[0]!;
}

export function resolveSessionPlugins(
  presetId?: string,
  overrides?: Record<string, boolean>,
): HarnessPluginDefinition[] {
  const enabled = new Set(getAgentPreset(presetId).pluginIds);
  for (const [pluginId, isEnabled] of Object.entries(overrides ?? {})) {
    if (isEnabled) enabled.add(pluginId);
    else enabled.delete(pluginId);
  }
  return HARNESS_PLUGINS.filter((plugin) => enabled.has(plugin.id));
}

export function buildSessionSystemPrompt(
  presetId?: string,
  overrides?: Record<string, boolean>,
  customInstructions = "",
  planningMode = false,
): string {
  const enabled = new Set(
    resolveSessionPlugins(presetId, overrides).map((plugin) => plugin.id),
  );
  return [
    enabled.has("persona") ? MODELHUB_AGENT_CONTEXT : "",
    enabled.has("agent-instructions") ? customInstructions.trim() : "",
    planningMode && enabled.has("plan-mode")
      ? "Planning mode is active. Analyze the request and return a clear, actionable plan. Do not call tools or claim that you executed steps."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function getRuntimeToolDefinitions(
  presetId?: string,
  overrides?: Record<string, boolean>,
): RuntimeToolDefinition[] {
  return resolveSessionPlugins(presetId, overrides).flatMap((plugin) =>
    plugin.tool ? [plugin.tool] : [],
  );
}

export function getEnabledRuntimeToolNames(
  presetId?: string,
  overrides?: Record<string, boolean>,
): Set<string> {
  return new Set(
    getRuntimeToolDefinitions(presetId, overrides).map(
      (definition) => definition.function.name,
    ),
  );
}

/** Convert validated session MCP tools into OpenAI-compatible function definitions. */
export function getMcpRuntimeToolDefinitions(
  servers?: readonly McpServerLike[],
): RuntimeToolDefinition[] {
  return (servers ?? []).flatMap((server) =>
    server.enabled
      ? server.tools
          .filter((tool) => tool.enabled !== false)
          .map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.runtimeName,
              description: `[MCP: ${server.id}] ${tool.description || tool.name}`,
              parameters: tool.inputSchema,
            },
          }))
      : [],
  );
}
