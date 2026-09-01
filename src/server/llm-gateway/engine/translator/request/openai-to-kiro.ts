/**
 * OpenAI to Kiro Request Translator
 * Converts OpenAI Chat Completions format to Kiro/AWS CodeWhisperer format
 */
import { register } from "../registry";
import { FORMATS } from "../formats";
import { v4 as uuidv4 } from "uuid";
import { applyKiroSessionReplay } from "../../utils/kiroSessionReplay";
import { resolveContinuationId, resolveSessionIdentity } from "../../utils/sessionManager";
import {
  resolveKiroModelIntent,
  applyKiroThinkingOverride,
  resolveKiroThinkingBudget,
  buildThinkingSystemPrefix,
  KIRO_AGENTIC_SYSTEM_PROMPT,
  resolveDefaultProfileArn,
  buildKiroAdditionalModelRequestFieldsForModel,
  usesKiroNativeGptEffort
} from "../../config/kiroConstants";
import { parseDataUri } from "../concerns/image";
import { DEFAULT_IMAGE_MIME } from "../schema/index";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index";
import {
  canonicalizeKiroConversation,
  normalizeKiroToolSpecs,
} from "../concerns/kiroConversation";
import type { KiroTurn, KiroToolSpec } from "../concerns/openaiTypes";

/**
 * Safely parse JSON string, returning fallback on failure.
 */
function safeJSONParse(str: unknown, fallback: unknown): unknown {
  if (typeof str !== "string") return str ?? fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// ── Message conversion state & helpers ──────────────────────────────────────

interface ConversionState {
  history: KiroTurn[];
  currentMessage: KiroTurn | null;
  pendingUserContent: string[];
  pendingAssistantContent: string[];
  pendingToolResults: Record<string, unknown>[];
  pendingImages: Record<string, unknown>[];
  currentRole: string | null;
}

/** Flush pending user or assistant content into a history turn */
function flushPendingRole(state: ConversionState) {
  if (state.currentRole === "user") {
    const content = state.pendingUserContent.join("\n\n").trim() || "continue";
    const userMsg: KiroTurn = {
      userInputMessage: { content, modelId: "" }
    };
    if (state.pendingImages.length > 0) {
      userMsg.userInputMessage!.images = state.pendingImages;
    }
    if (state.pendingToolResults.length > 0) {
      userMsg.userInputMessage!.userInputMessageContext = {
        toolResults: state.pendingToolResults
      };
    }
    state.history.push(userMsg);
    state.currentMessage = userMsg;
    state.pendingUserContent = [];
    state.pendingToolResults = [];
    state.pendingImages = [];
  } else if (state.currentRole === "assistant") {
    const content = state.pendingAssistantContent.join("\n\n").trim() || "...";
    state.history.push({
      assistantResponseMessage: { content }
    });
    state.pendingAssistantContent = [];
  }
}

/** Extract text content from a user message's content array, collecting images and tool results */
function extractUserContent(msg: Record<string, unknown>): {
  textParts: string[];
  images: Record<string, unknown>[];
  toolResults: Record<string, unknown>[];
} {
  const textParts: string[] = [];
  const images: Record<string, unknown>[] = [];
  const toolResults: Record<string, unknown>[] = [];

  if (typeof msg.content === "string") {
    textParts.push(msg.content);
  } else if (Array.isArray(msg.content)) {
    for (const c of msg.content as Record<string, unknown>[]) {
      if (c.type === OPENAI_BLOCK.TEXT || c.text) {
        textParts.push((c.text as string) || "");
      } else if (c.type === OPENAI_BLOCK.IMAGE_URL) {
        const url = ((c.image_url as Record<string, unknown>)?.url as string) || "";
        const parsed = parseDataUri(url);
        if (parsed) {
          const format = parsed.mimeType.split("/")[1] || parsed.mimeType;
          images.push({ format, source: { bytes: parsed.base64 } });
        } else if (url.startsWith("http://") || url.startsWith("https://")) {
          textParts.push(`[Image: ${url}]`);
        }
      } else if (c.type === CLAUDE_BLOCK.IMAGE) {
        const source = c.source as Record<string, unknown> | undefined;
        if (source?.type === "base64" && source?.data) {
          const mediaType = (source.media_type as string) || DEFAULT_IMAGE_MIME;
          const format = mediaType.split("/")[1] || mediaType;
          images.push({ format, source: { bytes: source.data } });
        }
      }
    }

    // Check for tool_result blocks
    const toolResultBlocks = (msg.content as Record<string, unknown>[]).filter(
      (c: Record<string, unknown>) => c.type === CLAUDE_BLOCK.TOOL_RESULT
    );
    for (const block of toolResultBlocks) {
      const blockContent = block.content;
      const text = Array.isArray(blockContent)
        ? (blockContent as Record<string, unknown>[]).map((c: Record<string, unknown>) => (c.text as string) || "").join("\n")
        : (typeof blockContent === "string" ? blockContent : "");
      toolResults.push({
        toolUseId: block.tool_use_id,
        status: block.is_error ? "error" : "success",
        content: [{ text }]
      });
    }
  }

  return { textParts, images, toolResults };
}

/** Build a Kiro tool result from an OpenAI role=tool message */
function extractToolResult(msg: Record<string, unknown>): Record<string, unknown> {
  const toolContent = typeof msg.content === "string" ? msg.content : "";
  return {
    toolUseId: msg.tool_call_id,
    status: msg.is_error || msg.status === "error" ? "error" : "success",
    content: [{ text: toolContent }]
  };
}

/** Extract text and tool uses from an assistant message */
function extractAssistantContent(msg: Record<string, unknown>): {
  textContent: string;
  toolUses: Record<string, unknown>[];
} {
  let textContent = "";
  let toolUses: Record<string, unknown>[] = [];

  if (Array.isArray(msg.content)) {
    const textBlocks = (msg.content as Record<string, unknown>[]).filter(
      (c: Record<string, unknown>) => c.type === OPENAI_BLOCK.TEXT
    );
    textContent = textBlocks.map((b: Record<string, unknown>) => b.text).join("\n").trim();
    const toolUseBlocks = (msg.content as Record<string, unknown>[]).filter(
      (c: Record<string, unknown>) => c.type === CLAUDE_BLOCK.TOOL_USE
    );
    toolUses = toolUseBlocks;
  } else if (typeof msg.content === "string") {
    textContent = msg.content.trim();
  }

  if (msg.tool_calls && (msg.tool_calls as unknown[]).length > 0) {
    toolUses = msg.tool_calls as Record<string, unknown>[];
  }

  return { textContent, toolUses };
}

/** Convert OpenAI tool_calls/tool_use to Kiro toolUse format and attach to last assistant message */
function attachToolUsesToLastAssistant(history: KiroTurn[], toolUses: Record<string, unknown>[]) {
  const lastMsg = history[history.length - 1];
  if (!lastMsg?.assistantResponseMessage) return;
  lastMsg.assistantResponseMessage.toolUses = toolUses.map((tc: Record<string, unknown>) => {
    if (tc.function) {
      const fn = tc.function as Record<string, unknown>;
      return {
        toolUseId: (tc.id as string) || uuidv4(),
        name: fn.name as string,
        input: safeJSONParse(fn.arguments, {})
      };
    }
    return {
      toolUseId: (tc.id as string) || uuidv4(),
      name: tc.name as string,
      input: tc.input || {}
    };
  });
}

/** Process a single message during conversion, updating state */
function processMessage(msg: Record<string, unknown>, state: ConversionState, _model: string) {
  let role = msg.role as string;
  const wasSystem = role === ROLE.SYSTEM;
  if (role === ROLE.SYSTEM || role === ROLE.TOOL) role = ROLE.USER;

  if (role !== state.currentRole && state.currentRole !== null) {
    flushPendingRole(state);
  }
  state.currentRole = role;

  if (role === ROLE.USER) {
    const { textParts, images, toolResults } = extractUserContent(msg);
    state.pendingImages.push(...images);
    state.pendingToolResults.push(...toolResults);

    if (msg.role === ROLE.TOOL) {
      state.pendingToolResults.push(extractToolResult(msg));
    } else {
      const content = textParts.join("\n");
      if (content) {
        state.pendingUserContent.push(
          wasSystem ? `<instructions>\n${content}\n</instructions>` : content
        );
      }
    }
  } else if (role === ROLE.ASSISTANT) {
    const { textContent, toolUses } = extractAssistantContent(msg);
    if (textContent) state.pendingAssistantContent.push(textContent);
    if (toolUses.length > 0) {
      flushPendingRole(state);
      attachToolUsesToLastAssistant(state.history, toolUses);
      state.currentRole = null;
    }
  }
}

/** Merge consecutive user messages (Kiro requires alternating user/assistant) */
function mergeConsecutiveUserMessages(history: KiroTurn[]): KiroTurn[] {
  const merged: KiroTurn[] = [];
  for (const current of history) {
    if (current.userInputMessage && merged.length > 0 && merged[merged.length - 1].userInputMessage) {
      const prev = merged[merged.length - 1];
      prev.userInputMessage!.content += "\n\n" + current.userInputMessage!.content;
      const prevCtx = prev.userInputMessage!.userInputMessageContext;
      const curCtx = current.userInputMessage!.userInputMessageContext;
      if (curCtx) {
        if (!prevCtx) {
          prev.userInputMessage!.userInputMessageContext = curCtx;
        } else {
          if (curCtx.toolResults && curCtx.toolResults.length > 0) {
            prevCtx.toolResults = [...(prevCtx.toolResults || []), ...curCtx.toolResults];
          }
          if (curCtx.tools && curCtx.tools.length > 0) {
            prevCtx.tools = [...(prevCtx.tools || []), ...curCtx.tools];
          }
        }
      }
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/** Clean up history entries for Kiro API compatibility */
function cleanupKiroHistory(history: KiroTurn[], model: string) {
  for (const item of history) {
    if (item.userInputMessage?.userInputMessageContext &&
        Object.keys(item.userInputMessage.userInputMessageContext).length === 0) {
      delete item.userInputMessage.userInputMessageContext;
    }
    if (item.userInputMessage && !item.userInputMessage.modelId) {
      item.userInputMessage.modelId = model;
    }
  }
}

/**
 * Convert OpenAI messages to Kiro format
 * Rules: system/tool/user -> user role, merge consecutive same roles.
 *
 * Returns { history, currentMessage }.
 */
function convertMessages(messages: Record<string, unknown>[], model: string): { history: KiroTurn[]; currentMessage: KiroTurn } {
  const state: ConversionState = {
    history: [],
    currentMessage: null,
    pendingUserContent: [],
    pendingAssistantContent: [],
    pendingToolResults: [],
    pendingImages: [],
    currentRole: null,
  };

  for (const msg of messages) {
    processMessage(msg, state, model);
  }

  if (state.currentRole !== null) {
    flushPendingRole(state);
  }

  // Pop last userInputMessage as currentMessage
  for (let i = state.history.length - 1; i >= 0; i--) {
    if (state.history[i].userInputMessage) {
      state.currentMessage = state.history.splice(i, 1)[0];
      break;
    }
  }

  cleanupKiroHistory(state.history, model);
  const mergedHistory = mergeConsecutiveUserMessages(state.history);

  if (!state.currentMessage) {
    state.currentMessage = {
      userInputMessage: { content: "", modelId: model }
    };
  }

  return { history: mergedHistory, currentMessage: state.currentMessage };
}

// ── Request builder helpers ─────────────────────────────────────────────────

/** Resolve profile ARN based on auth method */
function resolveKiroProfileArn(credentials: Record<string, unknown> | undefined): string {
  const providerSpecificData = credentials?.providerSpecificData as Record<string, unknown> | undefined;
  const authMethod = providerSpecificData?.authMethod as string | undefined;
  const accountBoundAuth = authMethod === "api_key" || authMethod === "idc" || authMethod === "external_idp";
  return accountBoundAuth
    ? ((providerSpecificData?.profileArn as string) || "")
    : ((providerSpecificData?.profileArn as string) || resolveDefaultProfileArn(authMethod || ""));
}

/** Build system prompt parts for Kiro */
function buildKiroSystemPrompt(
  thinkingBudget: number | null,
  usesNativeGptEffort: boolean,
  agentic: boolean,
): string {
  const parts: string[] = [];
  if (thinkingBudget !== null && !usesNativeGptEffort) {
    parts.push(buildThinkingSystemPrefix(thinkingBudget));
  }
  if (agentic) parts.push(KIRO_AGENTIC_SYSTEM_PROMPT);
  return parts.filter(Boolean).join("\n\n");
}

/** Build and validate Kiro conversation state */
function buildKiroConversationState(
  history: KiroTurn[],
  currentMessage: KiroTurn,
  upstreamModel: string,
  toolSpecs: KiroToolSpec[],
  nameMap: Map<string, string>,
  conversationId: string,
  continuationId: string,
  systemPrompt: string,
  contentPrefix: string,
  currentTimeContext: string,
): { valid: boolean; history: KiroTurn[]; currentMessage: KiroTurn; errors?: string[] } | null {
  const replay = applyKiroSessionReplay({
    conversationId,
    connectionId: "",
    modelId: upstreamModel,
    systemPrompt,
    contentPrefix,
    currentContentPrefix: currentTimeContext,
    history: history as unknown as Record<string, unknown>[],
    currentMessage: currentMessage as unknown as Record<string, unknown>,
  });
  const canonical = canonicalizeKiroConversation({
    history: replay.history,
    currentMessage: replay.currentMessage,
    modelId: upstreamModel,
    toolSpecs,
    nameMap,
  });
  if (!canonical.valid) {
    console.error(`[Kiro] refusing invalid conversation (openai → kiro): ${(canonical.errors || []).join(", ") || "unknown"} | turns=${(canonical.history || []).length + 1}`);
    return null;
  }
  return canonical;
}

/** Build the final Kiro payload */
function buildKiroPayload(
  canonical: { history: KiroTurn[]; currentMessage: KiroTurn },
  upstreamModel: string,
  conversationId: string,
  continuationId: string,
  profileArn: string,
  systemPrompt: string,
  additionalModelRequestFields: Record<string, unknown> | undefined,
  maxTokens: number,
  temperature: unknown,
  topP: unknown,
): Record<string, unknown> {
  const replayCurrent = canonical.currentMessage.userInputMessage!;
  const payload: Record<string, unknown> = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId,
      agentContinuationId: continuationId,
      agentTaskType: "vibe",
      currentMessage: {
        userInputMessage: {
          content: replayCurrent.content || "",
          modelId: upstreamModel,
          origin: "AI_EDITOR",
          ...(replayCurrent.images && replayCurrent.images.length > 0 && { images: replayCurrent.images }),
          ...(replayCurrent.userInputMessageContext && { userInputMessageContext: replayCurrent.userInputMessageContext })
        }
      },
      history: canonical.history
    },
    agentMode: "vibe",
  };

  if (profileArn) payload.profileArn = profileArn;
  if (systemPrompt) payload.systemPrompt = systemPrompt;
  if (additionalModelRequestFields) payload.additionalModelRequestFields = additionalModelRequestFields;

  if (maxTokens || temperature !== undefined || topP !== undefined) {
    const inferenceConfig: Record<string, unknown> = {};
    if (maxTokens) inferenceConfig.maxTokens = maxTokens;
    if (temperature !== undefined) inferenceConfig.temperature = temperature;
    if (topP !== undefined) inferenceConfig.topP = topP;
    payload.inferenceConfig = inferenceConfig;
  }

  Object.defineProperty(payload, "_kiroUpstreamModel", {
    value: upstreamModel,
    enumerable: false
  });

  return payload;
}

/**
 * Build Kiro payload from OpenAI format
 *
 * Two modelhub-specific behaviours implemented here:
 *
 * 1. `-agentic` model suffix. Synthetic variant — same upstream model, but we
 *    inject a chunked-write system prompt to keep large file writes under
 *    Kiro's 2-3 minute server timeout. The suffix is stripped before being
 *    sent upstream.
 *
 * 2. Thinking / reasoning. Detection covers Anthropic-Beta header, Claude API
 *    `thinking`, OpenAI `reasoning_effort`, AMP/Cursor magic tags, and model
 *    name hints. Supported models receive Kiro's schema-specific effort fields;
 *    legacy prompt tags remain only for models that need them.
 */
function openaiToKiroRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials?: Record<string, unknown>) {
  const messages = (body.messages as Record<string, unknown>[]) || [];
  const tools = body.tools || [];
  const maxTokens = 32000;
  const temperature = body.temperature;
  const topP = body.top_p;

  const modelIntent = resolveKiroModelIntent(model);
  const { upstream: upstreamModel, agentic } = modelIntent;
  const thinkingBody = applyKiroThinkingOverride(body, modelIntent.thinkingOverride);
  const thinkingBudget = resolveKiroThinkingBudget(thinkingBody, (credentials as Record<string, unknown>)?.rawHeaders as Record<string, string> | undefined, modelIntent.model) ?? null;
  const additionalModelRequestFields = buildKiroAdditionalModelRequestFieldsForModel(thinkingBody, upstreamModel);
  const usesNativeGptEffort = usesKiroNativeGptEffort(thinkingBody, upstreamModel);

  const { specs: toolSpecs, nameMap } = normalizeKiroToolSpecs(tools);
  const { history, currentMessage } = convertMessages(messages, upstreamModel);

  const profileArn = resolveKiroProfileArn(credentials as Record<string, unknown>);
  const timestamp = new Date().toISOString();
  const systemPrompt = buildKiroSystemPrompt(thinkingBudget, usesNativeGptEffort, agentic);
  const currentTimeContext = `[Context: Current time is ${timestamp}]`;
  const contentPrefix = [systemPrompt, currentTimeContext].filter(Boolean).join("\n\n");

  const rawHeaders = (credentials as Record<string, unknown>)?.rawHeaders as Record<string, string> | undefined;
  const connectionId = (credentials as Record<string, unknown>)?.connectionId as string | undefined;
  const sessionIdentity = resolveSessionIdentity({ headers: rawHeaders, body, connectionId, scope: "kiro" });
  const conversationId = sessionIdentity.sessionId;
  const continuationId = resolveContinuationId({
    sessionId: conversationId,
    connectionId,
    scope: "kiro",
    ephemeral: sessionIdentity.ephemeral,
  });

  const canonical = buildKiroConversationState(
    history, currentMessage, upstreamModel, toolSpecs, nameMap,
    conversationId, continuationId, systemPrompt, contentPrefix, currentTimeContext,
  );
  if (!canonical) return null;

  return buildKiroPayload(
    canonical, upstreamModel, conversationId, continuationId,
    profileArn, systemPrompt, additionalModelRequestFields,
    maxTokens, temperature, topP,
  );
}

register(FORMATS.OPENAI, FORMATS.KIRO, openaiToKiroRequest as unknown as Parameters<typeof register>[2], null);
