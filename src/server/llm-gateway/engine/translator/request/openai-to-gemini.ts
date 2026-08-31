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
  cleanJSONSchemaForAntigravity
} from "../formats/gemini";
import { deriveSessionId, toNumericSessionId } from "../../utils/sessionManager";
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

function normalizeGeminiContents(contents: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const c of contents || []) {
    if (!c?.role || !Array.isArray(c.parts) || c.parts.length === 0) continue;
    const last = out.at(-1);
    if (last?.role === c.role) (last.parts as unknown[]).push(...(c.parts as unknown[]));
    else out.push({ ...c, parts: [...(c.parts as unknown[])] });
  }
  return out;
}

// Core: Convert OpenAI request to Gemini format (base for all variants)
function openaiToGeminiBase(model: string, body: Record<string, unknown>, stream: boolean, signature: string = DEFAULT_THINKING_AG_SIGNATURE): Record<string, unknown> {
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

  // Build tool responses cache
  const toolResponses: Record<string, unknown> = {};
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages as Record<string, unknown>[]) {
      if (msg.role === ROLE.TOOL && msg.tool_call_id) {
        toolResponses[msg.tool_call_id as string] = msg.content;
      }
    }
  }

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
          const toolCallIds: string[] = [];
          for (const tc of msg.tool_calls as Record<string, unknown>[]) {
            if (tc.type !== OPENAI_BLOCK.FUNCTION) continue;

            const args = tryParseJSON(((tc.function as Record<string, unknown>)?.arguments as string) || "{}");
            parts.push({
              thoughtSignature: signature,
              functionCall: {
                id: tc.id,
                name: sanitizeGeminiFunctionName((tc.function as Record<string, unknown>).name),
                args: args
              }
            });
            toolCallIds.push(tc.id as string);
          }

          if (parts.length > 0) {
            contents.push({ role: GEMINI_ROLE.MODEL, parts });
          }

          // Check if there are actual tool responses in the next messages
          const hasActualResponses = toolCallIds.some(fid => toolResponses[fid]);

          if (hasActualResponses) {
            const toolParts: Record<string, unknown>[] = [];
            for (const fid of toolCallIds) {
              if (!toolResponses[fid]) continue;

              let name = tcID2Name[fid];
              if (!name) {
                const idParts = fid.split("-");
                if (idParts.length > 2) {
                  name = idParts.slice(0, -2).join("-");
                } else {
                  name = fid;
                }
              }

              const resp = toolResponses[fid] as string;
              let parsedResp = tryParseJSON(resp);
              if (parsedResp === null) {
                parsedResp = { result: resp };
              } else if (typeof parsedResp !== "object") {
                parsedResp = { result: parsedResp };
              }

              toolParts.push({
                functionResponse: {
                  id: fid,
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
export function openaiToGeminiRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  return openaiToGeminiBase(model, body, stream);
}

// OpenAI -> Gemini CLI (Cloud Code Assist)
function openaiToGeminiCLIRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  const gemini = openaiToGeminiBase(model, body, stream, DEFAULT_THINKING_GEMINI_CLI_SIGNATURE);
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

  // Antigravity specific fields
  if (isAntigravity) {
    envelope.requestType = "agent";
  } else {
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
    requestType: "agent",
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
        for (const block of msg.content as Record<string, unknown>[]) {
          if (block.type === CLAUDE_BLOCK.TEXT) {
            parts.push({ text: block.text });
          } else if (block.type === CLAUDE_BLOCK.TOOL_USE) {
            parts.push({
              thoughtSignature: signature,
              functionCall: {
                id: block.id,
                name: sanitizeGeminiFunctionName(block.name),
                args: block.input || {}
              }
            });
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

  const geminiCLI = openaiToGeminiCLIRequest(model, body, stream);
  return wrapInCloudCodeEnvelope(model, geminiCLI, credentials, true);
}

// Register
register(FORMATS.OPENAI, FORMATS.GEMINI, openaiToGeminiRequest as unknown as Parameters<typeof register>[2], null);
register(FORMATS.OPENAI, FORMATS.GEMINI_CLI, ((model: string, body: Record<string, unknown>, stream: boolean, credentials: Record<string, unknown> | null) => wrapInCloudCodeEnvelope(model, openaiToGeminiCLIRequest(model, body, stream), credentials)) as unknown as Parameters<typeof register>[2], null);
register(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, openaiToAntigravityRequest as unknown as Parameters<typeof register>[2], null);
