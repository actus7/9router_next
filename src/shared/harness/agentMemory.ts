import type { RuntimeToolDefinition } from "./agentPlugins";

export type MemoryScope = "agent" | "user";

export interface AgentMemorySnapshot {
  revision: number;
  agent: readonly MemoryEntryView[];
  user: readonly MemoryEntryView[];
  agentChars: number;
  userChars: number;
  agentLimit: number;
  userLimit: number;
}

export interface MemoryEntryView {
  id: string;
  scope: MemoryScope;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export const MEMORY_CHAR_LIMITS: Record<MemoryScope, number> = {
  agent: 2200,
  user: 1375,
};

export const MAX_MEMORY_ENTRY_CHARS = 800;

export interface HarnessLearningConfigView {
  memoryWriteApproval: boolean;
  memoryAgentEnabled: boolean;
  memoryUserEnabled: boolean;
  learningReviewEnabled: boolean;
  learningReviewModel: string;
  learningDeferWhenBusy: boolean;
  memoryNotifications: boolean;
}

const memoryTool = (
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

export function buildMemoryPromptBlock(snapshot: AgentMemorySnapshot): string {
  const sections: string[] = [];
  if (snapshot.agent.length > 0) {
    sections.push(
      "Agent memory (persistent facts the assistant should remember):",
      ...snapshot.agent.map((entry) => `- [${entry.id}] ${entry.content}`),
    );
  }
  if (snapshot.user.length > 0) {
    sections.push(
      "User memory (preferences and context about the user):",
      ...snapshot.user.map((entry) => `- [${entry.id}] ${entry.content}`),
    );
  }
  if (sections.length === 0) return "";
  return [
    ...sections,
    "",
    "Use memory_add, memory_replace, or memory_remove to update memory when the user asks or when a durable fact should persist.",
    `Limits: agent ${snapshot.agentChars}/${snapshot.agentLimit} chars, user ${snapshot.userChars}/${snapshot.userLimit} chars.`,
  ].join("\n");
}

export function getMemoryRuntimeToolDefinitions(): RuntimeToolDefinition[] {
  return [
    memoryTool(
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
    memoryTool(
      "memory_replace",
      "Replace an existing memory entry by id.",
      {
        id: { type: "string", description: "Entry id from the memory block." },
        content: { type: "string", description: "New content." },
      },
      ["id", "content"],
    ),
    memoryTool(
      "memory_remove",
      "Remove a memory entry by id.",
      {
        id: { type: "string", description: "Entry id to remove." },
      },
      ["id"],
    ),
  ];
}

export function getSupplementalMemoryToolDefinitions(): RuntimeToolDefinition[] {
  return getMemoryRuntimeToolDefinitions().slice(1);
}
