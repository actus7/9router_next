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
  "ModelHub composes its plugins from rows: bundles declare default rows in code and the pluginRows database table is a patch layer over them, so an empty table reproduces the defaults exactly.",
  "A row names a factory and carries a config. The harness-capability factory takes a HarnessPluginDefinition, declared in the exact file src/shared/harness/agentPlugins.ts; the provider-executor factory takes a provider id. Both are declared in src/server/plugin-core/factories.ts and composed by src/server/plugin-core/composition.ts.",
  "Adding a capability row through the database changes the running catalogue without a rebuild. Adding a new factory, or code a factory mounts, is a repository change that needs a build.",
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
  {
    id: "tool-skills",
    title: "Agent Skills",
    description:
      "Loads Agent Skill instructions on demand from the session skill catalog.",
    module: "@modelhub/harness-tool-skills",
    kind: "tool",
    tool: tool(
      "load_skill",
      "Load the full instructions for an Agent Skill by id. Call this before applying a skill listed in the system prompt.",
      {
        name: {
          type: "string",
          description: "Skill id (kebab-case slug from the available skills list).",
        },
      },
      ["name"],
    ),
  },
  {
    id: "tool-memory",
    title: "Agent memory",
    description:
      "Persists curated agent and user memory across sessions via memory_add, memory_replace, and memory_remove.",
    module: "@modelhub/harness-tool-memory",
    kind: "tool",
    tool: tool(
      "memory_add",
      "Add a new memory entry. Use scope 'agent' for assistant facts, 'user' for user preferences.",
      {
        scope: {
          type: "string",
          enum: ["agent", "user"],
          description: "Memory scope.",
        },
        content: {
          type: "string",
          description: "Concise fact to remember (plain text).",
        },
      },
      ["scope", "content"],
    ),
  },
  {
    id: "tool-session-search",
    title: "Session search",
    description: "Full-text search across past chat sessions indexed by ModelHub.",
    module: "@modelhub/harness-tool-session-search",
    kind: "tool",
    tool: tool(
      "search_past_sessions",
      "Search indexed messages from past chat sessions. Use for recalling prior work, decisions, or context from earlier conversations.",
      {
        query: {
          type: "string",
          description: "Search terms (keywords or phrases).",
        },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "Maximum hits to return. Defaults to 8.",
        },
        exclude_session_id: {
          type: "string",
          description: "Optional session id to exclude (usually the current session).",
        },
      },
      ["query"],
    ),
  },
  {
    id: "tool-harness-governance",
    title: "Harness governance",
    description:
      "Stages plugin toggles and new capability proposals for user approval.",
    module: "@modelhub/harness-tool-governance",
    kind: "tool",
    tool: tool(
      "toggle_plugin",
      "Enable or disable a harness plugin globally via an override row (requires approval when write_approval is on).",
      {
        plugin_id: {
          type: "string",
          description: "Plugin id from the harness catalogue (e.g. tool-web-search).",
        },
        enabled: {
          type: "boolean",
          description: "Desired enabled state.",
        },
      },
      ["plugin_id", "enabled"],
    ),
  },
  {
    id: "tool-skill-authoring",
    title: "Skill authoring",
    description:
      "Creates and updates Agent Skills stored in ModelHub via create_skill and update_skill.",
    module: "@modelhub/harness-tool-skill-authoring",
    kind: "tool",
    tool: tool(
      "create_skill",
      "Create a new Agent Skill. Prefer loading skill-creator first for format guidance.",
      {
        name: { type: "string", description: "Unique skill id (kebab-case)." },
        description: {
          type: "string",
          description: "Short description shown before load_skill.",
        },
        body: { type: "string", description: "Markdown instructions." },
      },
      ["name", "description", "body"],
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
      "tool-skills",
      "tool-memory",
      "tool-session-search",
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

/**
 * The set of capabilities a session can compose from. It defaults to the rows
 * the bundle declares in this file; the server replaces it after boot with the
 * catalogue composed from the plugin patch layer, and the client fetches that
 * same composed catalogue. Resolution is a projection over whichever catalogue
 * is active, which is what lets a conversation vary without a per-session
 * runtime. See docs/superpowers/specs/2026-09-02-db-plugin-system-design.md.
 */
export interface HarnessCatalog {
  plugins: readonly HarnessPluginDefinition[];
  presets: readonly AgentPresetDefinition[];
}

export const BUNDLE_CATALOG: HarnessCatalog = {
  plugins: HARNESS_PLUGINS,
  presets: AGENT_PRESETS,
};

/**
 * Pairs a plugin list with presets that make sense for it: "standard" always
 * means every plugin present, and a curated preset is narrowed to the plugins
 * that actually exist, so a preset can never name a capability the catalogue
 * no longer has.
 */
export function buildHarnessCatalog(
  plugins: readonly HarnessPluginDefinition[],
): HarnessCatalog {
  const available = new Set(plugins.map((plugin) => plugin.id));
  const presets = AGENT_PRESETS.map((preset) =>
    preset.id === DEFAULT_AGENT_PRESET_ID
      ? { ...preset, pluginIds: plugins.map((plugin) => plugin.id) }
      : { ...preset, pluginIds: preset.pluginIds.filter((id) => available.has(id)) },
  );
  return { plugins, presets };
}

let activeCatalog: HarnessCatalog = BUNDLE_CATALOG;

export function setActiveHarnessCatalog(catalog: HarnessCatalog): void {
  activeCatalog = catalog;
}

export function getActiveHarnessCatalog(): HarnessCatalog {
  return activeCatalog;
}

/** Restores the bundle defaults. Used by tests and by a failed composition. */
export function resetActiveHarnessCatalog(): void {
  activeCatalog = BUNDLE_CATALOG;
}

export function getAgentPresetFrom(
  catalog: HarnessCatalog,
  id?: string,
): AgentPresetDefinition {
  return catalog.presets.find((preset) => preset.id === id) ?? catalog.presets[0]!;
}

export function resolveSessionPluginsFrom(
  catalog: HarnessCatalog,
  presetId?: string,
  overrides?: Record<string, boolean>,
): HarnessPluginDefinition[] {
  const enabled = new Set(getAgentPresetFrom(catalog, presetId).pluginIds);
  for (const [pluginId, isEnabled] of Object.entries(overrides ?? {})) {
    if (isEnabled) enabled.add(pluginId);
    else enabled.delete(pluginId);
  }
  return catalog.plugins.filter((plugin) => enabled.has(plugin.id));
}

export function getAgentPreset(id?: string): AgentPresetDefinition {
  return getAgentPresetFrom(activeCatalog, id);
}

export function resolveSessionPlugins(
  presetId?: string,
  overrides?: Record<string, boolean>,
): HarnessPluginDefinition[] {
  return resolveSessionPluginsFrom(activeCatalog, presetId, overrides);
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

export function getProposeHarnessCapabilityToolDefinition(): RuntimeToolDefinition {
  return tool(
    "propose_harness_capability",
    "Propose a new harness capability row for user approval before it is installed.",
    {
      title: { type: "string", description: "Human-readable capability title." },
      description: { type: "string", description: "What the capability does." },
      tool_name: {
        type: "string",
        description: "Runtime tool name the capability would expose.",
      },
    },
    ["title", "description", "tool_name"],
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
