/**
 * Claude → Kiro Request Translator (DIRECT route, no OpenAI pivot)
 *
 * Converts Anthropic Messages API requests straight to Kiro / AWS
 * CodeWhisperer `GenerateAssistantResponse` payloads. This is the function the
 * direct `claude:kiro` route in ../index.js uses; it is NOT reached through the
 * claude→openai→kiro pivot.
 *
 * After session replay it delegates to the shared Kiro conversation
 * canonicalizer. That layer enforces adjacent one-to-one tool use/results,
 * repairs partial parallel calls, and flattens compacted structured references
 * that can no longer be represented safely.
 *
 * It also handles the 9router-synthetic `-agentic` / `-thinking` suffixes and
 * the `<thinking_mode>enabled</thinking_mode>` reasoning trigger, matching
 * buildKiroPayload.
 */
import { register } from "../registry";
import { FORMATS } from "../formats";
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
  usesKiroNativeGptEffort,
} from "../../config/kiroConstants";
import { DEFAULT_IMAGE_MIME } from "../schema/index";
import { ROLE, CLAUDE_BLOCK } from "../schema/index";
import {
  canonicalizeKiroConversation,
  normalizeKiroToolSpecs,
} from "../concerns/kiroConversation";

/**
 * Convert Claude messages to Kiro history + currentMessage.
 * Kiro requires alternating user/assistant turns; consecutive same-role
 * messages are merged.
 */
function convertClaudeMessagesToKiro(messages: Record<string, unknown>[], model: string) {
  const history: Record<string, unknown>[] = [];
  let currentMessage: Record<string, unknown> | null = null;

  let pendingUserContent: string[] = [];
  let pendingAssistantContent: string[] = [];
  let pendingToolResults: Record<string, unknown>[] = [];
  let pendingImages: Record<string, unknown>[] = [];
  let currentRole: string | null = null;

  const flushPending = () => {
    if (currentRole === ROLE.USER) {
      const content = pendingUserContent.join("\n\n").trim() || "continue";
      const userMsg: Record<string, unknown> = { userInputMessage: { content, modelId: model } };

      if (pendingImages.length > 0) {
        ((userMsg.userInputMessage as Record<string, unknown>).images as Record<string, unknown>[]) = pendingImages;
      }
      if (pendingToolResults.length > 0) {
        (userMsg.userInputMessage as Record<string, unknown>).userInputMessageContext = {
          toolResults: pendingToolResults,
        };
      }
      history.push(userMsg);
      currentMessage = userMsg;
      pendingUserContent = [];
      pendingToolResults = [];
      pendingImages = [];
    } else if (currentRole === ROLE.ASSISTANT) {
      const content = pendingAssistantContent.join("\n\n").trim() || "...";
      history.push({ assistantResponseMessage: { content } });
      pendingAssistantContent = [];
    }
  };

  for (const msg of messages) {
    const role = msg.role as string;
    if (role !== currentRole && currentRole !== null) flushPending();
    currentRole = role;

    if (role === ROLE.USER) {
      if (typeof msg.content === "string") {
        pendingUserContent.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content as Record<string, unknown>[]) {
          if (block.type === CLAUDE_BLOCK.TEXT) {
            pendingUserContent.push(block.text as string);
          } else if (block.type === CLAUDE_BLOCK.IMAGE && (block.source as Record<string, unknown>)?.type === "base64") {
            const source = block.source as Record<string, unknown>;
            const mediaType = (source.media_type as string) || DEFAULT_IMAGE_MIME;
            const format = mediaType.split("/")[1] || mediaType;
            pendingImages.push({ format, source: { bytes: source.data } });
          } else if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
            let resultContent = "";
            if (typeof block.content === "string") {
              resultContent = block.content;
            } else if (Array.isArray(block.content)) {
              resultContent =
                (block.content as Record<string, unknown>[])
                  .filter((c: Record<string, unknown>) => c.type === CLAUDE_BLOCK.TEXT)
                  .map((c: Record<string, unknown>) => c.text)
                  .join("\n") || JSON.stringify(block.content);
            } else if (block.content) {
              resultContent = JSON.stringify(block.content);
            }
            pendingToolResults.push({
              toolUseId: block.tool_use_id,
              status: block.is_error ? "error" : "success",
              content: [{ text: resultContent }],
            });
          }
        }
      }
    } else if (role === ROLE.ASSISTANT) {
      let textContent = "";
      const toolUses: Record<string, unknown>[] = [];
      if (typeof msg.content === "string") {
        textContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content as Record<string, unknown>[]) {
          if (block.type === CLAUDE_BLOCK.TEXT) {
            textContent += block.text as string;
          } else if (block.type === CLAUDE_BLOCK.TOOL_USE) {
            toolUses.push({
              toolUseId: block.id,
              name: block.name,
              input: block.input || {},
            });
          }
        }
      }
      if (textContent) pendingAssistantContent.push(textContent);

      if (toolUses.length > 0) {
        flushPending();
        const lastMsg = history[history.length - 1];
        if (lastMsg?.assistantResponseMessage) {
          (lastMsg.assistantResponseMessage as Record<string, unknown>).toolUses = toolUses;
        }
        currentRole = null;
      }
    }
  }

  if (currentRole !== null) flushPending();

  // Pop the last user turn as currentMessage (skip trailing assistant turns).
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].userInputMessage) {
      currentMessage = history.splice(i, 1)[0];
      break;
    }
  }

  history.forEach((item: Record<string, unknown>) => {
    const uim = item.userInputMessage as Record<string, unknown> | undefined;
    if (
      uim?.userInputMessageContext &&
      Object.keys(uim.userInputMessageContext as Record<string, unknown>).length === 0
    ) {
      delete uim.userInputMessageContext;
    }
    if (uim && !uim.modelId) {
      uim.modelId = model;
    }
  });

  // Merge consecutive user turns (Kiro requires alternating roles).
  const mergedHistory: Record<string, unknown>[] = [];
  for (const current of history) {
    const prev = mergedHistory[mergedHistory.length - 1];
    if (current.userInputMessage && prev?.userInputMessage) {
      const prevUim = prev.userInputMessage as Record<string, unknown>;
      const curUim = current.userInputMessage as Record<string, unknown>;
      prevUim.content = (prevUim.content as string) + "\n\n" + (curUim.content as string);
      const prevCtx = prevUim.userInputMessageContext as Record<string, unknown> | undefined;
      const curCtx = curUim.userInputMessageContext as Record<string, unknown> | undefined;
      if (curCtx) {
        if (!prevCtx) {
          prevUim.userInputMessageContext = curCtx;
        } else {
          if ((curCtx.toolResults as unknown[])?.length > 0) {
            prevCtx.toolResults = [
              ...((prevCtx.toolResults as unknown[]) || []),
              ...(curCtx.toolResults as unknown[]),
            ];
          }
          if ((curCtx.tools as unknown[])?.length > 0) {
            prevCtx.tools = [...((prevCtx.tools as unknown[]) || []), ...(curCtx.tools as unknown[])];
          }
        }
      }
    } else {
      mergedHistory.push(current);
    }
  }

  if (!currentMessage) {
    currentMessage = { userInputMessage: { content: "", modelId: model } };
  }

  return { history: mergedHistory, currentMessage };
}

function extractClaudeSystemText(system: unknown): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return (system as unknown[]).map((s: unknown) => {
      if (typeof s === "string") return s;
      return (s as Record<string, unknown>)?.text || "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

/**
 * Build a Kiro payload directly from a Claude Messages API request body.
 */
function claudeToKiroRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials: Record<string, unknown>) {
  const messages = Array.isArray(body.messages) ? body.messages as Record<string, unknown>[] : [];
  const tools = Array.isArray(body.tools) ? body.tools as Record<string, unknown>[] : [];
  const maxTokens = (body.max_tokens as number) || 32000;
  const temperature = body.temperature;
  const topP = body.top_p;

  const modelIntent = resolveKiroModelIntent(model);
  const { upstream: upstreamModel, agentic } = modelIntent;
  const credObj = credentials as Record<string, unknown>;
  const thinkingBody = applyKiroThinkingOverride(body, modelIntent.thinkingOverride);
  const thinkingBudget = resolveKiroThinkingBudget(thinkingBody, (credObj?.rawHeaders as never), modelIntent.model);
  const additionalModelRequestFields = buildKiroAdditionalModelRequestFieldsForModel(thinkingBody, upstreamModel);
  const usesNativeGptEffort = usesKiroNativeGptEffort(thinkingBody, upstreamModel);

  const { specs: toolSpecs, nameMap } = normalizeKiroToolSpecs(tools);
  const { history, currentMessage } = convertClaudeMessagesToKiro(messages, upstreamModel);

  // api_key / idc / external_idp must never use the shared default ARN (belongs
  // to another account → 403 "bearer token invalid"); OAuth/social fall back to it.
  const psd = credObj?.providerSpecificData as Record<string, unknown> | undefined;
  const authMethod = psd?.authMethod as string | undefined;
  const accountBoundAuth =
    authMethod === "api_key" || authMethod === "idc" || authMethod === "external_idp";
  const profileArn = accountBoundAuth
    ? ((psd?.profileArn as string) || "")
    : ((psd?.profileArn as string) || resolveDefaultProfileArn(authMethod as string));

  // Kiro CLI/KAS sends system prompt as top-level `systemPrompt`. Keep a
  // content fallback too because the CodeWhisperer surface does not always
  // enforce top-level systemPrompt for direct calls.
  const timestamp = new Date().toISOString();
  const systemPromptParts: string[] = [];
  if (thinkingBudget !== null && !usesNativeGptEffort) {
    systemPromptParts.push(buildThinkingSystemPrefix(thinkingBudget));
  }
  if (agentic) systemPromptParts.push(KIRO_AGENTIC_SYSTEM_PROMPT);
  const systemInstruction = extractClaudeSystemText(body.system);
  if (systemInstruction) systemPromptParts.push(systemInstruction);
  const systemPrompt = systemPromptParts.filter(Boolean).join("\n\n");
  const currentTimeContext = `[Context: Current time is ${timestamp}]`;
  const contentPrefix = [systemPrompt, currentTimeContext].filter(Boolean).join("\n\n");

  const sessionIdentity = resolveSessionIdentity({
    headers: credObj?.rawHeaders as Record<string, string> | undefined,
    body,
    connectionId: credObj?.connectionId as string | undefined,
    scope: "kiro",
  });
  const conversationId = sessionIdentity.sessionId;
  const continuationId = resolveContinuationId({
    sessionId: conversationId,
    connectionId: credObj?.connectionId as string | null | undefined,
    scope: "kiro",
    ephemeral: sessionIdentity.ephemeral,
  });
  const replay = applyKiroSessionReplay({
    conversationId,
    connectionId: credObj?.connectionId as string | undefined,
    modelId: upstreamModel,
    systemPrompt,
    contentPrefix,
    currentContentPrefix: currentTimeContext,
    history,
    currentMessage,
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
    console.error(`[Kiro] refusing invalid conversation (claude → kiro): ${(canonical.errors || []).join(", ") || "unknown"} | turns=${(canonical.history || []).length + 1}`);
    return null;
  }
  const replayCurrent = canonical.currentMessage.userInputMessage;
  const userInputMessage: Record<string, unknown> = {
    content: replayCurrent?.content || "",
    modelId: upstreamModel,
    origin: "AI_EDITOR",
    ...(replayCurrent?.userInputMessageContext && {
      userInputMessageContext: replayCurrent.userInputMessageContext,
    }),
    ...(replayCurrent?.images && {
      images: replayCurrent.images,
    }),
  };

  const payload: Record<string, unknown> = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId,
      agentContinuationId: continuationId,
      agentTaskType: "vibe",
      currentMessage: {
        userInputMessage,
      },
      history: canonical.history,
    },
    agentMode: "vibe",
  };

  if (profileArn) payload.profileArn = profileArn;
  if (systemPrompt) payload.systemPrompt = systemPrompt;
  if (additionalModelRequestFields) {
    payload.additionalModelRequestFields = additionalModelRequestFields;
  }

  if (maxTokens || temperature !== undefined || topP !== undefined) {
    payload.inferenceConfig = {} as Record<string, unknown>;
    if (maxTokens) (payload.inferenceConfig as Record<string, unknown>).maxTokens = maxTokens;
    if (temperature !== undefined) (payload.inferenceConfig as Record<string, unknown>).temperature = temperature;
    if (topP !== undefined) (payload.inferenceConfig as Record<string, unknown>).topP = topP;
  }

  // Non-enumerable hint so the executor can route the upstream model id.
  Object.defineProperty(payload, "_kiroUpstreamModel", {
    value: upstreamModel,
    enumerable: false,
  });

  return payload;
}

register(FORMATS.CLAUDE, FORMATS.KIRO, claudeToKiroRequest as unknown as Parameters<typeof register>[2], null);
