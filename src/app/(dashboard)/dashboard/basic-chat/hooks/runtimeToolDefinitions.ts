export const runtimeToolDefinitions = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web using the application's configured search provider. Use this for current information and cite the returned URLs.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Focused web search query." },
          max_results: { type: "integer", minimum: 1, maximum: 10, description: "Maximum number of results. Defaults to 5." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch and extract a public web page using the application's configured web-fetch provider.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri", description: "Public HTTP(S) URL to fetch." },
          max_characters: { type: "integer", minimum: 500, maximum: 30_000, description: "Maximum extracted characters. Defaults to 12,000." },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_task",
      description: "Delegate one bounded research or analysis task to an ephemeral subagent. The subagent cannot call tools or delegate further; use it only when parallel independent analysis helps.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Self-contained task, context, and expected output for the subagent." },
        },
        required: ["task"],
        additionalProperties: false,
      },
    },
  },
] as const;
