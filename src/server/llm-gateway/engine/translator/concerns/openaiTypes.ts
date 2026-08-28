// Shared OpenAI-pivot types for translator concerns + response files.

/** Metadata for building an OpenAI chat.completion.chunk */
export interface ChunkMeta {
  id: string;
  created: number;
  model: string;
}

/** OpenAI usage object with optional detail sections */
export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_creation_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

/** Input for buildUsage */
export interface BuildUsageInput {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
}

/** Provider kind for usage extraction */
export type UsageKind = "claude" | "gemini" | "kiro" | "ollama" | "commandcode";

/** Capabilities object from getCapabilitiesForModel */
export interface ModelCapabilities {
  vision: boolean;
  pdf: boolean;
  audioInput: boolean;
  videoInput: boolean;
  imageOutput: boolean;
  audioOutput: boolean;
  search: boolean;
  tools: boolean;
  reasoning: boolean;
  thinkingFormat: string | null;
  thinkingCanDisable: boolean;
  thinkingRange: { min?: number; max?: number } | null;
  contextWindow: number;
  maxOutput: number;
}

/** Thinking config extracted from request body */
export interface ThinkingConfig {
  mode: "none" | "auto" | "budget" | "level";
  budget?: number;
  level?: string;
}

/** Image fetch options */
export interface ImageFetchOptions {
  signal?: AbortSignal | null;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Strip rule for paramSupport */
export interface StripRule {
  provider?: string;
  match?: RegExp | ((model: string) => boolean);
  drop?: string[];
  flattenContent?: boolean;
  clampToModelMaxOutput?: boolean;
  maxOutputCap?: number;
}

/** Image ref for prefetch */
export interface ImageRef {
  get: () => string;
  set?: (v: string) => void;
  part?: Record<string, unknown>;
  claudeBlock?: Record<string, unknown>;
}

/** Translator state (base) */
export interface TranslatorState {
  [key: string]: unknown;
}

/** Kiro tool use */
export interface KiroToolUse {
  toolUseId?: string;
  name?: string;
  input?: unknown;
}

/** Kiro tool result */
export interface KiroToolResult {
  toolUseId?: string;
  status?: string;
  content?: unknown;
}

/** Kiro user input message context */
export interface KiroUserInputMessageContext {
  toolResults?: KiroToolResult[];
  tools?: unknown[];
}

/** Kiro user input message */
export interface KiroUserInputMessage {
  content?: string;
  modelId?: string;
  userInputMessageContext?: KiroUserInputMessageContext;
  images?: unknown[];
}

/** Kiro assistant response message */
export interface KiroAssistantResponseMessage {
  content?: string;
  toolUses?: KiroToolUse[];
}

/** Kiro turn */
export interface KiroTurn {
  userInputMessage?: KiroUserInputMessage;
  assistantResponseMessage?: KiroAssistantResponseMessage;
}

/** Kiro tool spec */
export interface KiroToolSpec {
  toolSpecification?: {
    name?: string;
    description?: string;
    inputSchema?: { json?: unknown };
  };
}

/** Kiro repairs */
export interface KiroRepairs {
  missingResults: number;
  orphanResults: number;
  invalidToolUses: number;
}
