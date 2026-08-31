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

/**
 * Convert OpenAI messages to Kiro format
 * Rules: system/tool/user -> user role, merge consecutive same roles.
 *
 * Returns { history, currentMessage }.
 */
function convertMessages(messages: Record<string, unknown>[], model: string): { history: KiroTurn[]; currentMessage: KiroTurn } {
  const history: KiroTurn[] = [];
  let currentMessage: KiroTurn | null = null;

  let pendingUserContent: string[] = [];
  let pendingAssistantContent: string[] = [];
  let pendingToolResults: Record<string, unknown>[] = [];
  let pendingImages: Record<string, unknown>[] = [];
  let currentRole: string | null = null;

  const flushPending = () => {
    if (currentRole === "user") {
      const content = pendingUserContent.join("\n\n").trim() || "continue";
      const userMsg: KiroTurn = {
        userInputMessage: {
          content: content,
          modelId: ""
        }
      };

      // Attach images if present (Kiro API supports images field)
      if (pendingImages.length > 0) {
        userMsg.userInputMessage!.images = pendingImages;
      }

      if (pendingToolResults.length > 0) {
        userMsg.userInputMessage!.userInputMessageContext = {
          toolResults: pendingToolResults
        };
      }

      history.push(userMsg);
      currentMessage = userMsg;
      pendingUserContent = [];
      pendingToolResults = [];
      pendingImages = [];
    } else if (currentRole === "assistant") {
      const content = pendingAssistantContent.join("\n\n").trim() || "...";
      const assistantMsg: KiroTurn = {
        assistantResponseMessage: {
          content: content
        }
      };
      history.push(assistantMsg);
      pendingAssistantContent = [];
    }
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    let role = msg.role as string;

    // Normalize: system/tool -> user
    const wasSystem = role === ROLE.SYSTEM;
    if (role === ROLE.SYSTEM || role === ROLE.TOOL) {
      role = ROLE.USER;
    }

    // If role changes, flush pending
    if (role !== currentRole && currentRole !== null) {
      flushPending();
    }
    currentRole = role;

    if (role === ROLE.USER) {
      // Extract content
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        for (const c of msg.content as Record<string, unknown>[]) {
          if (c.type === OPENAI_BLOCK.TEXT || c.text) {
            textParts.push((c.text as string) || "");
          } else if (c.type === OPENAI_BLOCK.IMAGE_URL) {
            // OpenAI format: image_url.url with data URI
            const url = ((c.image_url as Record<string, unknown>)?.url as string) || "";
            const parsed = parseDataUri(url);
            if (parsed) {
              const format = parsed.mimeType.split("/")[1] || parsed.mimeType;
              pendingImages.push({ format, source: { bytes: parsed.base64 } });
            } else if (url.startsWith("http://") || url.startsWith("https://")) {
              // Kiro only supports base64 — fallback to URL text
              textParts.push(`[Image: ${url}]`);
            }
          } else if (c.type === CLAUDE_BLOCK.IMAGE) {
            // Claude format: source.type = "base64", source.media_type, source.data
            const source = c.source as Record<string, unknown> | undefined;
            if (source?.type === "base64" && source?.data) {
              const mediaType = (source.media_type as string) || DEFAULT_IMAGE_MIME;
              const format = mediaType.split("/")[1] || mediaType;
              pendingImages.push({ format, source: { bytes: source.data } });
            }
          }
        }
        content = textParts.join("\n");

        // Check for tool_result blocks
        const toolResultBlocks = (msg.content as Record<string, unknown>[]).filter((c: Record<string, unknown>) => c.type === CLAUDE_BLOCK.TOOL_RESULT);
        if (toolResultBlocks.length > 0) {
          toolResultBlocks.forEach((block: Record<string, unknown>) => {
            const blockContent = block.content;
            const text = Array.isArray(blockContent)
              ? (blockContent as Record<string, unknown>[]).map((c: Record<string, unknown>) => (c.text as string) || "").join("\n")
              : (typeof blockContent === "string" ? blockContent : "");

            pendingToolResults.push({
              toolUseId: block.tool_use_id,
              status: block.is_error ? "error" : "success",
              content: [{ text: text }]
            });
          });
        }
      }

      // Handle tool role (from normalized)
      if (msg.role === ROLE.TOOL) {
        const toolContent = typeof msg.content === "string" ? msg.content : "";
        pendingToolResults.push({
          toolUseId: msg.tool_call_id,
          status: msg.is_error || msg.status === "error" ? "error" : "success",
          content: [{ text: toolContent }]
        });
      } else if (content) {
        // <instructions> tags: Claude models treat these as authoritative directives.
        pendingUserContent.push(
          wasSystem ? `<instructions>\n${content}\n</instructions>` : content
        );
      }
    } else if (role === ROLE.ASSISTANT) {
      // Extract text content and tool uses
      let textContent = "";
      let toolUses: Record<string, unknown>[] = [];

      if (Array.isArray(msg.content)) {
        const textBlocks = (msg.content as Record<string, unknown>[]).filter((c: Record<string, unknown>) => c.type === OPENAI_BLOCK.TEXT);
        textContent = textBlocks.map((b: Record<string, unknown>) => b.text).join("\n").trim();

        const toolUseBlocks = (msg.content as Record<string, unknown>[]).filter((c: Record<string, unknown>) => c.type === CLAUDE_BLOCK.TOOL_USE);
        toolUses = toolUseBlocks;
      } else if (typeof msg.content === "string") {
        textContent = msg.content.trim();
      }

      if (msg.tool_calls && (msg.tool_calls as unknown[]).length > 0) {
        toolUses = msg.tool_calls as Record<string, unknown>[];
      }

      if (textContent) {
        pendingAssistantContent.push(textContent);
      }

      // Store tool uses in last assistant message
      if (toolUses.length > 0) {
        // Flush to create assistant message with toolUses
        flushPending();

        const lastMsg = history[history.length - 1];
        if (lastMsg?.assistantResponseMessage) {
          lastMsg.assistantResponseMessage.toolUses = toolUses.map((tc: Record<string, unknown>) => {
            if (tc.function) {
              const fn = tc.function as Record<string, unknown>;
              return {
                toolUseId: (tc.id as string) || uuidv4(),
                name: fn.name as string,
                input: safeJSONParse(fn.arguments, {})
              };
            } else {
              return {
                toolUseId: (tc.id as string) || uuidv4(),
                name: tc.name as string,
                input: tc.input || {}
              };
            }
          });
        }

        currentRole = null;
      }
    }
  }

  // Flush remaining
  if (currentRole !== null) {
    flushPending();
  }

  // Pop last userInputMessage as currentMessage (search from end, skip trailing assistant messages)
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].userInputMessage) {
      currentMessage = history.splice(i, 1)[0];
      break;
    }
  }

  // Clean up history for Kiro API compatibility
  history.forEach((item: KiroTurn) => {
    if (item.userInputMessage?.userInputMessageContext &&
        Object.keys(item.userInputMessage.userInputMessageContext).length === 0) {
      delete item.userInputMessage.userInputMessageContext;
    }
    if (item.userInputMessage && !item.userInputMessage.modelId) {
      item.userInputMessage.modelId = model;
    }
  });

  // Merge consecutive user messages (Kiro requires alternating user/assistant)
  // When merging, also combine userInputMessageContext fields so toolResults
  // and images from the second message are not silently dropped.
  const mergedHistory: KiroTurn[] = [];
  for (let i = 0; i < history.length; i++) {
    const current = history[i];
    if (current.userInputMessage &&
        mergedHistory.length > 0 &&
        mergedHistory[mergedHistory.length - 1].userInputMessage) {
      const prev = mergedHistory[mergedHistory.length - 1];
      prev.userInputMessage!.content += "\n\n" + current.userInputMessage!.content;
      // Merge context: combine toolResults, images, etc.
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
      mergedHistory.push(current);
    }
  }

  // When currentMessage is null (no user messages at all — edge case where
  // input is only assistant messages), create a minimal currentMessage so
  // tools and content can be injected.
  if (!currentMessage) {
    currentMessage = {
      userInputMessage: {
        content: "",
        modelId: model,
      }
    };
  }

  return { history: mergedHistory, currentMessage };
}

/**
 * Build Kiro payload from OpenAI format
 *
 * Two 9router-specific behaviours implemented here:
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
  const thinkingBudget = resolveKiroThinkingBudget(thinkingBody, (credentials as Record<string, unknown>)?.rawHeaders as Record<string, string> | undefined, modelIntent.model);
  const additionalModelRequestFields = buildKiroAdditionalModelRequestFieldsForModel(thinkingBody, upstreamModel);
  const usesNativeGptEffort = usesKiroNativeGptEffort(thinkingBody, upstreamModel);

  const { specs: toolSpecs, nameMap } = normalizeKiroToolSpecs(tools);
  const { history, currentMessage } = convertMessages(messages, upstreamModel);

  // API-key (headless) auth uses a raw CodeWhisperer credential whose profile is
  // account-specific. Injecting the shared builder-id/social *default* placeholder
  // ARN makes CodeWhisperer reject the request with 403 "bearer token invalid"
  // (the ARN doesn't belong to the key's account). So for api_key, only send a
  // profileArn that was actually resolved for this connection — never the default.
  // OAuth/social keep the default fallback (their tokens accept it).
  // api_key / idc / external_idp carry an account-specific (or token-bound)
  // profile. The shared builder-id/social default ARN belongs to a different
  // account and triggers 403 "bearer token invalid", so never fall back to it —
  // send the resolved ARN, or an empty string so CodeWhisperer uses the token's
  // own default profile. Only OAuth/social keep the shared placeholder.
  const providerSpecificData = (credentials as Record<string, unknown>)?.providerSpecificData as Record<string, unknown> | undefined;
  const authMethod = providerSpecificData?.authMethod as string | undefined;
  const accountBoundAuth =
    authMethod === "api_key" || authMethod === "idc" || authMethod === "external_idp";
  const profileArn = accountBoundAuth
    ? ((providerSpecificData?.profileArn as string) || "")
    : ((providerSpecificData?.profileArn as string) || resolveDefaultProfileArn(authMethod || ""));

  const timestamp = new Date().toISOString();

  // Kiro CLI/KAS sends these as top-level systemPrompt. Keep a content fallback
  // too because the CodeWhisperer surface does not always enforce top-level
  // systemPrompt for direct calls.
  const systemPromptParts: string[] = [];
  if (thinkingBudget !== null && !usesNativeGptEffort) {
    systemPromptParts.push(buildThinkingSystemPrefix(thinkingBudget));
  }
  if (agentic) {
    systemPromptParts.push(KIRO_AGENTIC_SYSTEM_PROMPT);
  }
  const systemPrompt = systemPromptParts.filter(Boolean).join("\n\n");
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
  const replay = applyKiroSessionReplay({
    conversationId,
    connectionId,
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
  // canonicalizeKiroConversation() already ran its second-chance repair (flatten
  // every structured tool turn to text, then re-validate). A body that is STILL
  // invalid here cannot be made shippable, and Kiro answers it with
  // 400 {"message":"Improperly formed request.","reason":"REQUEST_BODY_INVALID"}.
  // Fail locally instead: chatCore turns a falsy return into a 400 without
  // spending an upstream call or a per-account cooldown. The taxonomy
  // (role:N | pair:N | id:N | spec:N | orphan:0 | current) names the offending
  // turn so the shape can be diagnosed from the log alone.
  if (!canonical.valid) {
    console.error(`[Kiro] refusing invalid conversation (openai → kiro): ${(canonical.errors || []).join(", ") || "unknown"} | turns=${(canonical.history || []).length + 1}`);
    return null;
  }
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
          ...(replayCurrent.images && replayCurrent.images.length > 0 && {
            images: replayCurrent.images
          }),
          ...(replayCurrent.userInputMessageContext && {
            userInputMessageContext: replayCurrent.userInputMessageContext
          })
        }
      },
      history: canonical.history
    },
    agentMode: "vibe",
  };

  if (profileArn) {
    payload.profileArn = profileArn;
  }
  if (systemPrompt) payload.systemPrompt = systemPrompt;
  if (additionalModelRequestFields) {
    payload.additionalModelRequestFields = additionalModelRequestFields;
  }

  if (maxTokens || temperature !== undefined || topP !== undefined) {
    const inferenceConfig: Record<string, unknown> = {};
    if (maxTokens) inferenceConfig.maxTokens = maxTokens;
    if (temperature !== undefined) inferenceConfig.temperature = temperature;
    if (topP !== undefined) inferenceConfig.topP = topP;
    payload.inferenceConfig = inferenceConfig;
  }

  // Tag payload so the executor can route the upstream model id correctly.
  Object.defineProperty(payload, "_kiroUpstreamModel", {
    value: upstreamModel,
    enumerable: false
  });

  return payload;
}

register(FORMATS.OPENAI, FORMATS.KIRO, openaiToKiroRequest as unknown as Parameters<typeof register>[2], null);
