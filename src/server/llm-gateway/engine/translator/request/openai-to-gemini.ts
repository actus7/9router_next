import { register } from "../registry";
import { FORMATS } from "../formats";
import { DEFAULT_THINKING_AG_SIGNATURE, DEFAULT_THINKING_GEMINI_CLI_SIGNATURE } from "../../config/defaultThinkingSignature";
import { openaiToClaudeRequestForAntigravity } from "./openai-to-claude";
function generateUUID() {
  return crypto.randomUUID();
}

import {
  DEFAULT_SAFETY_SETTINGS,
  convertOpenAIContentToParts,
  extractTextContent,
  tryParseJSON,
  generateRequestId,
  generateSessionId,
  generateProjectId,
  cleanJSONSchemaForAntigravity,
  normalizeGeminiContents
} from "../formats/gemini";
import { deriveSessionId, toNumericSessionId } from "../../utils/sessionManager";
import { getGeminiThoughtSignatureSync } from "../../services/thoughtSignatureStore";
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index";

// Sanitize function names for Gemini API.
// Gemini requires: starts with [a-zA-Z_], followed by [a-zA-Z0-9_.:\-], max 64 chars.
// Replace any invalid character with '_' and truncate to 64.
function sanitizeGeminiFunctionName(name: unknown): string {
  if (!name) return "_unknown";
  const nameStr = String(name);
  // Replace any char not in [a-zA-Z0-9_.:\-] with '_'
  let sanitized = nameStr.replace(/[^a-zA-Z0-9_.:\-]/g, "_");
  // First char must be letter or underscore
  if (!/^[a-zA-Z_]/.test(sanitized)) {
    sanitized = "_" + sanitized;
  }
  // Truncate to 64 chars
  return sanitized.substring(0, 64);
}

/**
 * Rewrites duplicate tool_call_ids so every emitted functionCall id is unique.
 *
 * Gemini validates functionCall id uniqueness across the WHOLE history and answers
 * 400 INVALID_ARGUMENT otherwise, but an OpenAI tool_call_id is only unique within its
 * own assistant turn: a long agent session can replay the same id in a later turn.
 *
 * Uniqueness is per occurrence, not per id: two different calls that share an id must
 * end up with different emitted ids, so each call takes the next free one in document
 * order and keeps it for its matching functionResponse. An id that was already unique
 * passes through untouched, so a valid conversation is byte-identical to before.
 */
function createToolCallIdUniquifier(): { next(id: string): string } {
  const used = new Set<string>();
  return {
    next(id: string): string {
      if (!id) return id;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
      // The id may itself end in "-2"; keep counting rather than collide again.
      let n = 2;
      let candidate = `${id}-${n}`;
      while (used.has(candidate)) candidate = `${id}-${++n}`;
      used.add(candidate);
      return candidate;
    },
  };
}

// Core: Convert OpenAI request to Gemini format (base for all variants)
function openaiToGeminiBase(model: string, body: Record<string, unknown>, stream: boolean, signature: string = DEFAULT_THINKING_AG_SIGNATURE, sessionId: string | null = null): Record<string, unknown> {
  const result: Record<string, unknown> = {
    model: model,
    contents: [] as Record<string, unknown>[],
    generationConfig: {} as Record<string, unknown>,
    safetySettings: DEFAULT_SAFETY_SETTINGS
  };

  const generationConfig = result.generationConfig as Record<string, unknown>;

  // Generation config
  if (body.temperature !== undefined) {
    generationConfig.temperature = body.temperature;
  }
  if (body.top_p !== undefined) {
    generationConfig.topP = body.top_p;
  }
  if (body.top_k !== undefined) {
    generationConfig.topK = body.top_k;
  }
  if (body.max_tokens !== undefined) {
    generationConfig.maxOutputTokens = body.max_tokens;
  }

  // Build tool_call_id -> name map
  const tcID2Name: Record<string, string> = {};
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages as Record<string, unknown>[]) {
      if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
        for (const tc of msg.tool_calls as Record<string, unknown>[]) {
          if (tc.type === OPENAI_BLOCK.FUNCTION && tc.id && (tc.function as Record<string, unknown>)?.name) {
            tcID2Name[tc.id as string] = (tc.function as Record<string, unknown>).name as string;
          }
        }
      }
    }
  }

  // Build tool responses cache.
  //
  // Queued per id rather than a single value: an OpenAI tool_call_id is only unique
  // within its own assistant turn, so a long agent session can reuse one id for two
  // different results. A plain id -> content map keeps only the LAST, and the earlier
  // turn would be answered with the later turn's output. Each functionCall consumes the
  // oldest unconsumed result for its id instead.
  const toolResponses: Record<string, unknown[]> = {};
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages as Record<string, unknown>[]) {
      if (msg.role === ROLE.TOOL && msg.tool_call_id) {
        (toolResponses[msg.tool_call_id as string] ||= []).push(msg.content);
      }
    }
  }
  const toolResponseCursor: Record<string, number> = {};
  const toolCallIdUniquifier = createToolCallIdUniquifier();

  const contents = result.contents as Record<string, unknown>[];

  // Convert messages
  if (body.messages && Array.isArray(body.messages)) {
    for (let i = 0; i < body.messages.length; i++) {
      const msg = (body.messages as Record<string, unknown>[])[i];
      const role = msg.role as string;
      const content = msg.content as string | Record<string, unknown>[];

      if (role === ROLE.SYSTEM && body.messages.length > 1) {
        result.systemInstruction = {
          role: GEMINI_ROLE.USER,
          parts: [{ text: typeof content === "string" ? content : extractTextContent(content) }]
        };
      } else if (role === ROLE.USER || (role === ROLE.SYSTEM && body.messages.length === 1)) {
        const parts = convertOpenAIContentToParts(content);
        if (parts.length > 0) {
          contents.push({ role: GEMINI_ROLE.USER, parts });
        }
      } else if (role === ROLE.ASSISTANT) {
        const parts: Record<string, unknown>[] = [];

        // Thinking/reasoning → thought part with signature
        if (msg.reasoning_content) {
          parts.push({
            thought: true,
            text: msg.reasoning_content
          });
          parts.push({
            thoughtSignature: signature,
            text: ""
          });
        }

        if (content) {
          const text = typeof content === "string" ? content : extractTextContent(content);
          if (text) {
            parts.push({ text });
          }
        }

        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          // The NAME travels with the pair for the same reason the id does: tcID2Name is a
          // conversation-wide id -> name map, so a later call reusing the id would
          // otherwise rename this turn's response.
          const toolCallIds: Array<{ origId: string; emitId: string; name: unknown }> = [];
          let firstFunctionCallSeen = false;
          for (const tc of msg.tool_calls as Record<string, unknown>[]) {
            if (tc.type !== OPENAI_BLOCK.FUNCTION) continue;

            const args = tryParseJSON(((tc.function as Record<string, unknown>)?.arguments as string) || "{}");
            const cachedSig = tc.id ? getGeminiThoughtSignatureSync(tc.id, sessionId, model) : null;
            // The first call gets the cached signature or the stand-in; parallel
            // siblings stay unsigned unless they have a cached one.
            const callSig = cachedSig || (!firstFunctionCallSeen ? signature : undefined);
            firstFunctionCallSeen = true;
            // The emitted id is uniquified; the thought-signature lookup above stays on the
            // ORIGINAL id so a cached signature is still found.
            const emitId = toolCallIdUniquifier.next(tc.id as string);
            const part: Record<string, unknown> = {
              functionCall: {
                id: emitId,
                name: sanitizeGeminiFunctionName((tc.function as Record<string, unknown>).name),
                args: args
              }
            };
            if (callSig) part.thoughtSignature = callSig;
            parts.push(part);
            toolCallIds.push({ origId: tc.id as string, emitId, name: (tc.function as Record<string, unknown> | undefined)?.name });
          }

          if (parts.length > 0) {
            contents.push({ role: GEMINI_ROLE.MODEL, parts });
          }

          // Check if there are actual tool responses in the next messages
          // An intermediate call (the conversation moved on) is answered with an
          // empty result rather than dropped, which Gemini rejects as an orphan.
          const isIntermediate = i < body.messages.length - 1;
          const hasActualResponses = toolCallIds.some(
            ({ origId }) => (toolResponseCursor[origId] || 0) < (toolResponses[origId]?.length ?? 0),
          );

          if (hasActualResponses || isIntermediate) {
            const toolParts: Record<string, unknown>[] = [];
            for (const { origId, emitId, name: callName } of toolCallIds) {
              // Content resolves on the ORIGINAL id, consuming the oldest unconsumed result;
              // only the emitted id is uniquified.
              const queue = toolResponses[origId];
              const cursor = toolResponseCursor[origId] || 0;
              let resp = "";
              if (queue && cursor < queue.length) {
                resp = queue[cursor] as string;
                toolResponseCursor[origId] = cursor + 1;
              }

              // The name comes from THIS call, not from the conversation-wide map, which a
              // later duplicate of the same id would have overwritten.
              let name = (callName as string | undefined) || tcID2Name[origId];
              if (!name) {
                const idParts = origId.split("-");
                if (idParts.length > 2) {
                  name = idParts.slice(0, -2).join("-");
                } else {
                  name = origId;
                }
              }

              let parsedResp = tryParseJSON(resp);
              if (parsedResp === null) {
                parsedResp = { result: resp };
              } else if (typeof parsedResp !== "object") {
                parsedResp = { result: parsedResp };
              }

              toolParts.push({
                functionResponse: {
                  // Matches the functionCall id emitted above, so a response never points at
                  // an id the call does not carry.
                  id: emitId,
                  name: sanitizeGeminiFunctionName(name),
                  response: { result: parsedResp }
                }
              });
            }
            if (toolParts.length > 0) {
              contents.push({ role: GEMINI_ROLE.USER, parts: toolParts });
            }
          }
        } else if (parts.length > 0) {
          contents.push({ role: GEMINI_ROLE.MODEL, parts });
        }
      }
    }
  }

  // Convert tools
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    const functionDeclarations: Record<string, unknown>[] = [];
    for (const t of body.tools as Record<string, unknown>[]) {
      // Check if already in Anthropic/Claude format (no type field, direct name/description/input_schema)
      if (t.name && t.input_schema) {
        const cleanedSchema = cleanJSONSchemaForAntigravity(structuredClone((t.input_schema as Record<string, unknown>) || { type: "object", properties: {} }));
        functionDeclarations.push({
          name: sanitizeGeminiFunctionName(t.name),
          description: t.description || "",
          parameters: cleanedSchema
        });
      }
      // OpenAI format
      else if (t.type === OPENAI_BLOCK.FUNCTION && t.function) {
        const fn = t.function as Record<string, unknown>;
        const cleanedSchema = cleanJSONSchemaForAntigravity(structuredClone((fn.parameters as Record<string, unknown>) || { type: "object", properties: {} }));
        functionDeclarations.push({
          name: sanitizeGeminiFunctionName(fn.name),
          description: fn.description || "",
          parameters: cleanedSchema
        });
      }
    }

    if (functionDeclarations.length > 0) {
      result.tools = [{ functionDeclarations }];
    }
  }

  result.contents = normalizeGeminiContents(contents);
  return result;
}

// OpenAI -> Gemini (standard API)
export function openaiToGeminiRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials: Record<string, unknown> | null = null): Record<string, unknown> {
  return openaiToGeminiBase(model, body, stream, DEFAULT_THINKING_AG_SIGNATURE, (credentials?._clientSessionId as string | null | undefined) ?? null);
}

// OpenAI -> Gemini CLI (Cloud Code Assist)
function openaiToGeminiCLIRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials: Record<string, unknown> | null = null): Record<string, unknown> {
  const gemini = openaiToGeminiBase(model, body, stream, DEFAULT_THINKING_GEMINI_CLI_SIGNATURE, (credentials?._clientSessionId as string | null | undefined) ?? null);
  // Thinking is normalized centrally by applyThinking (thinkingUnified.js) after translation.

  // Clean schema for tools
  if ((gemini.tools as Record<string, unknown>[])?.[0]?.functionDeclarations) {
    for (const fn of (gemini.tools as Record<string, unknown>[])[0].functionDeclarations as Record<string, unknown>[]) {
      if (fn.parameters) {
        const cleanedSchema = cleanJSONSchemaForAntigravity(fn.parameters as Record<string, unknown>);
        fn.parameters = cleanedSchema;
      }
    }
  }

  return gemini;
}

// Wrap Gemini CLI format in Cloud Code wrapper
function wrapInCloudCodeEnvelope(model: string, geminiCLI: Record<string, unknown>, credentials: Record<string, unknown> | null = null, isAntigravity = false): Record<string, unknown> {
  const projectId = (credentials?.projectId as string) || generateProjectId();

  const envelope: Record<string, unknown> = {
    project: projectId,
    model: model,
    userAgent: isAntigravity ? "antigravity" : "gemini-cli",
    requestId: isAntigravity ? `agent-${generateUUID()}` : generateRequestId(),
    request: {
      sessionId: toNumericSessionId(credentials?._clientSessionId as string) || (isAntigravity ? deriveSessionId((credentials?.email as string) || (credentials?.connectionId as string)) : generateSessionId()),
      contents: geminiCLI.contents,
      systemInstruction: geminiCLI.systemInstruction,
      generationConfig: geminiCLI.generationConfig,
      tools: geminiCLI.tools,
    } as Record<string, unknown>
  };

  // Antigravity specific fields. The official client omits `requestType` on
  // the agent (chat) path; sending "agent" gets a detail-free 429
  // RESOURCE_EXHAUSTED even with quota left (upstream decolua/9router 5798b30).
  if (!isAntigravity) {
    // Keep safetySettings for Gemini CLI
    (envelope.request as Record<string, unknown>).safetySettings = geminiCLI.safetySettings;
  }

  if ((geminiCLI.tools as unknown[])?.length > 0) {
    (envelope.request as Record<string, unknown>).toolConfig = {
      functionCallingConfig: { mode: "VALIDATED" }
    };
  }

  return envelope;
}

// Wrap Claude format in Cloud Code envelope for Antigravity
function wrapInCloudCodeEnvelopeForClaude(model: string, claudeRequest: Record<string, unknown>, credentials: Record<string, unknown> | null = null, signature: string = DEFAULT_THINKING_AG_SIGNATURE): Record<string, unknown> {
  const projectId = (credentials?.projectId as string) || generateProjectId();

  const envelope: Record<string, unknown> = {
    project: projectId,
    model: model,
    userAgent: "antigravity",
    requestId: `agent-${generateUUID()}`,
    // No `requestType` on the agent path — see wrapInCloudCodeEnvelope above.
    request: {
      sessionId: toNumericSessionId(credentials?._clientSessionId as string) || deriveSessionId((credentials?.email as string) || (credentials?.connectionId as string)),
      contents: [] as Record<string, unknown>[],
      generationConfig: {
        temperature: (claudeRequest.temperature as number) || 1,
        maxOutputTokens: (claudeRequest.max_tokens as number) || 4096
      }
    } as Record<string, unknown>
  };

  const request = envelope.request as Record<string, unknown>;
  const contents = request.contents as Record<string, unknown>[];

  // Build tool_use id -> name map so functionResponse can use the correct name
  const toolUseIdToName: Record<string, string> = {};
  if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
    for (const msg of claudeRequest.messages as Record<string, unknown>[]) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content as Record<string, unknown>[]) {
          if (block.type === CLAUDE_BLOCK.TOOL_USE && block.id && block.name) {
            toolUseIdToName[block.id as string] = block.name as string;
          }
        }
      }
    }
  }

  // Convert Claude messages to Gemini contents
  if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
    for (const msg of claudeRequest.messages as Record<string, unknown>[]) {
      const parts: Record<string, unknown>[] = [];

      if (Array.isArray(msg.content)) {
        let firstToolUseSeen = false;
        for (const block of msg.content as Record<string, unknown>[]) {
          if (block.type === CLAUDE_BLOCK.TEXT) {
            parts.push({ text: block.text });
          } else if (block.type === CLAUDE_BLOCK.TOOL_USE) {
            const cachedSig = block.id ? getGeminiThoughtSignatureSync(block.id, (credentials?._clientSessionId as string | null | undefined) ?? null, model) : null;
            const callSig = cachedSig || (!firstToolUseSeen ? signature : undefined);
            firstToolUseSeen = true;
            const part: Record<string, unknown> = {
              functionCall: {
                id: block.id,
                name: sanitizeGeminiFunctionName(block.name),
                args: block.input || {}
              }
            };
            if (callSig) part.thoughtSignature = callSig;
            parts.push(part);
          } else if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
            let content = block.content;
            if (Array.isArray(content)) {
              content = (content as Record<string, unknown>[]).map(c => c.type === CLAUDE_BLOCK.TEXT ? c.text : JSON.stringify(c)).join("\n");
            }
            // Resolve the original tool name from the id — Gemini requires it to match the functionCall name
            const resolvedName = toolUseIdToName[block.tool_use_id as string]
              ? sanitizeGeminiFunctionName(toolUseIdToName[block.tool_use_id as string])
              : "tool";
            parts.push({
              functionResponse: {
                id: block.tool_use_id,
                name: resolvedName,
                response: { result: tryParseJSON(content as string) || content }
              }
            });
          }
        }
      } else if (typeof msg.content === "string") {
        parts.push({ text: msg.content });
      }

      if (parts.length > 0) {
        contents.push({
          role: msg.role === ROLE.ASSISTANT ? GEMINI_ROLE.MODEL : GEMINI_ROLE.USER,
          parts
        });
      }
    }
  }

  // Convert Claude tools to Gemini functionDeclarations
  if (claudeRequest.tools && Array.isArray(claudeRequest.tools)) {
    const functionDeclarations: Record<string, unknown>[] = [];
    for (const tool of claudeRequest.tools as Record<string, unknown>[]) {
      if (tool.name && tool.input_schema) {
        const cleanedSchema = cleanJSONSchemaForAntigravity(tool.input_schema as Record<string, unknown>);
        functionDeclarations.push({
          name: sanitizeGeminiFunctionName(tool.name),
          description: tool.description || "",
          parameters: cleanedSchema
        });
      }
    }
    if (functionDeclarations.length > 0) {
      request.tools = [{ functionDeclarations }];
      request.toolConfig = {
        functionCallingConfig: { mode: "VALIDATED" }
      };
    }
  }

  const systemParts: Record<string, unknown>[] = [];
  // Merge user system prompt from claudeRequest
  if (claudeRequest.system) {
    if (Array.isArray(claudeRequest.system)) {
      for (const block of claudeRequest.system as Record<string, unknown>[]) {
        if (block.text) systemParts.push({ text: block.text });
      }
    } else if (typeof claudeRequest.system === "string") {
      systemParts.push({ text: claudeRequest.system });
    }
  }

  if (systemParts.length > 0) {
    request.systemInstruction = { role: GEMINI_ROLE.USER, parts: systemParts };
  }

  request.contents = normalizeGeminiContents(contents);
  return envelope;
}

// Detect if model should use Claude backend in Antigravity
// Claude models have specific ID patterns — more reliable than caps at routing level
function isClaudeModel(model: string): boolean {
  return model.toLowerCase().includes("claude");
}

// OpenAI -> Antigravity (Sandbox Cloud Code with wrapper)
function openaiToAntigravityRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials: Record<string, unknown> | null = null): Record<string, unknown> {
  if (isClaudeModel(model)) {
    const claudeRequest = openaiToClaudeRequestForAntigravity(model, body, stream) as Record<string, unknown>;
    return wrapInCloudCodeEnvelopeForClaude(model, claudeRequest, credentials);
  }

  const geminiCLI = openaiToGeminiCLIRequest(model, body, stream, credentials);
  return wrapInCloudCodeEnvelope(model, geminiCLI, credentials, true);
}

// Register
register(FORMATS.OPENAI, FORMATS.GEMINI, openaiToGeminiRequest as unknown as Parameters<typeof register>[2], null);
register(FORMATS.OPENAI, FORMATS.GEMINI_CLI, ((model: string, body: Record<string, unknown>, stream: boolean, credentials: Record<string, unknown> | null) => wrapInCloudCodeEnvelope(model, openaiToGeminiCLIRequest(model, body, stream, credentials), credentials)) as unknown as Parameters<typeof register>[2], null);
register(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, openaiToAntigravityRequest as unknown as Parameters<typeof register>[2], null);
