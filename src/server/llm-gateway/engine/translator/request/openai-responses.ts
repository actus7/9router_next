/**
 * Translator: OpenAI Responses API ↔ OpenAI Chat Completions
 *
 * Responses API uses: { input: [...], instructions: "..." }
 * Chat API uses: { messages: [...] }
 */
import { register } from "../registry";
import { FORMATS } from "../formats";
import { normalizeResponsesInput } from "../formats/responsesApi";
import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from "../schema/index";

// Responses API enforces max 64 chars on call_id (#393)
const MAX_CALL_ID_LEN = 64;
const clampCallId = (id: unknown): unknown => (typeof id === "string" && id.length > MAX_CALL_ID_LEN ? id.substring(0, MAX_CALL_ID_LEN) : id);

/**
 * Ensure object schema always has properties field (required by Codex Responses API)
 */
function normalizeToolParameters(params: unknown): unknown {
  if (!params) return { type: "object", properties: {} };
  const p = params as Record<string, unknown>;
  if (p.type === "object" && !p.properties) return { ...p, properties: {} };
  return params;
}

// ── Responses→Chat helpers ──────────────────────────────────────────────────

/** Extract reasoning text from summary[].text or content[].text */
function extractResponsesReasoningText(item: Record<string, unknown>): string {
  if (Array.isArray(item.summary)) {
    const txt = (item.summary as Record<string, unknown>[]).map((s: Record<string, unknown>) => (s?.text as string) || "").filter(Boolean).join("\n");
    if (txt) return txt;
  }
  if (Array.isArray(item.content)) {
    const txt = (item.content as Record<string, unknown>[]).map((c: Record<string, unknown>) => (c?.text as string) || "").filter(Boolean).join("\n");
    if (txt) return txt;
  }
  return "";
}

/** Attach buffered reasoning to a message and reset buffers */
function attachResponsesReasoning(
  msg: Record<string, unknown>,
  pendingReasoning: string,
  pendingReasoningEncrypted: string,
): { pendingReasoning: string; pendingReasoningEncrypted: string } {
  if (pendingReasoning) msg.reasoning_content = pendingReasoning;
  if (pendingReasoningEncrypted) msg.encrypted_content = pendingReasoningEncrypted;
  return { pendingReasoning: "", pendingReasoningEncrypted: "" };
}

/** Convert a Responses API message item to Chat Completions content parts */
function convertResponsesMessageContent(item: Record<string, unknown>): unknown {
  if (!Array.isArray(item.content)) return item.content;
  return (item.content as Record<string, unknown>[]).map((c: Record<string, unknown>) => {
    if (c.type === RESPONSES_ITEM.INPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
    if (c.type === RESPONSES_ITEM.OUTPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
    if (c.type === RESPONSES_ITEM.INPUT_IMAGE) {
      const url = c.image_url || c.file_id || "";
      return { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url, detail: c.detail || "auto" } };
    }
    return c;
  });
}

/** Process a function_call or custom_tool_call item → push to assistant tool_calls */
function processFunctionCallItem(
  item: Record<string, unknown>,
  itemType: string,
  currentAssistantMsg: Record<string, unknown>,
  customToolNames: Set<string>,
) {
  if (!item.name || typeof item.name !== "string" || (item.name as string).trim() === "") return;
  if (itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL) customToolNames.add(item.name as string);
  const toolInput = itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL
    ? { input: typeof item.input === "string" ? item.input : JSON.stringify(item.input ?? "") }
    : item.arguments;
  (currentAssistantMsg.tool_calls as Record<string, unknown>[]).push({
    id: item.call_id,
    type: OPENAI_BLOCK.FUNCTION,
    function: {
      name: item.name,
      arguments: typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput ?? {})
    }
  });
}

/** Convert Responses API input items to Chat Completions messages */
function convertResponsesInputItems(
  inputItems: Record<string, unknown>[],
  result: { messages: Record<string, unknown>[]; [key: string]: unknown },
): { additionalTools: Record<string, unknown>[]; customToolNames: Set<string> } {
  let currentAssistantMsg: Record<string, unknown> | null = null;
  let pendingToolResults: Record<string, unknown>[] = [];
  let pendingReasoning = "";
  let pendingReasoningEncrypted = "";
  const additionalTools: Record<string, unknown>[] = [];
  const customToolNames = new Set<string>();

  const flushPending = () => {
    if (currentAssistantMsg) {
      result.messages.push(currentAssistantMsg);
      currentAssistantMsg = null;
    }
    if (pendingToolResults.length > 0) {
      for (const tr of pendingToolResults) result.messages.push(tr);
      pendingToolResults = [];
    }
  };

  for (const item of inputItems) {
    const itemType = item.type || (item.role ? RESPONSES_ITEM.MESSAGE : null);

    if (itemType === RESPONSES_ITEM.MESSAGE) {
      flushPending();
      const content = convertResponsesMessageContent(item);
      const msg: Record<string, unknown> = { role: item.role, content };
      if (item.role === ROLE.ASSISTANT) {
        const reset = attachResponsesReasoning(msg, pendingReasoning, pendingReasoningEncrypted);
        pendingReasoning = reset.pendingReasoning;
        pendingReasoningEncrypted = reset.pendingReasoningEncrypted;
      } else {
        pendingReasoning = "";
        pendingReasoningEncrypted = "";
      }
      result.messages.push(msg);
    }
    else if (itemType === RESPONSES_ITEM.FUNCTION_CALL || itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL) {
      if (!currentAssistantMsg) {
        currentAssistantMsg = { role: ROLE.ASSISTANT, content: null, tool_calls: [] as Record<string, unknown>[] };
        const reset = attachResponsesReasoning(currentAssistantMsg, pendingReasoning, pendingReasoningEncrypted);
        pendingReasoning = reset.pendingReasoning;
        pendingReasoningEncrypted = reset.pendingReasoningEncrypted;
      }
      processFunctionCallItem(item, itemType, currentAssistantMsg, customToolNames);
    }
    else if (itemType === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT || itemType === RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT) {
      flushPending();
      result.messages.push({
        role: ROLE.TOOL,
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output)
      });
    }
    else if (itemType === RESPONSES_ITEM.ADDITIONAL_TOOLS) {
      if (Array.isArray(item.tools)) additionalTools.push(...(item.tools as Record<string, unknown>[]));
    }
    else if (itemType === RESPONSES_ITEM.REASONING) {
      const txt = extractResponsesReasoningText(item);
      if (txt) pendingReasoning = pendingReasoning ? `${pendingReasoning}\n${txt}` : txt;
      if (typeof item.encrypted_content === "string" && item.encrypted_content) {
        pendingReasoningEncrypted = item.encrypted_content as string;
      }
    }
  }

  flushPending();
  return { additionalTools, customToolNames };
}

/** Convert Responses API tools to Chat Completions function declarations */
function convertResponsesTools(
  body: Record<string, unknown>,
  additionalTools: Record<string, unknown>[],
  customToolNames: Set<string>,
  result: Record<string, unknown>,
) {
  const responseTools = [
    ...(Array.isArray(body.tools) ? body.tools as Record<string, unknown>[] : []),
    ...additionalTools,
  ];
  if (responseTools.length > 0) {
    result.tools = responseTools
      .map((tool: Record<string, unknown>) => {
        if (tool.function) return tool;
        const name = tool.name;
        if (!name || typeof name !== "string" || (name as string).trim() === "") return null;
        if (tool.type === "custom") {
          customToolNames.add(name as string);
          const format = tool.format as Record<string, unknown> | undefined;
          const formatHint = [format?.syntax, format?.definition].filter(Boolean).join("\n");
          return {
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name,
              description: [String(tool.description || ""), formatHint].filter(Boolean).join("\n\n"),
              parameters: {
                type: "object",
                properties: { input: { type: "string", description: "Raw freeform input for this custom tool" } },
                required: ["input"],
                additionalProperties: false
              }
            }
          };
        }
        return {
          type: OPENAI_BLOCK.FUNCTION,
          function: {
            name,
            description: String(tool.description || ""),
            parameters: normalizeToolParameters(tool.parameters),
            strict: tool.strict
          }
        };
      })
      .filter(Boolean);
  }
  if (customToolNames.size > 0) result._customToolNames = [...customToolNames];
}

/** Clean up Responses API specific fields from the result */
function cleanupResponsesFields(result: Record<string, unknown>) {
  if (result.max_output_tokens !== undefined) {
    if (result.max_tokens === undefined) result.max_tokens = result.max_output_tokens;
    delete result.max_output_tokens;
  }
  delete result.input;
  delete result.instructions;
  delete result.include;
  delete result.prompt_cache_key;
  delete result.store;
  if (typeof (result.reasoning as Record<string, unknown>)?.effort === "string") {
    result.reasoning_effort = (result.reasoning as Record<string, unknown>).effort;
  }
  delete result.reasoning;
  delete result.client_metadata;
}

/**
 * Convert OpenAI Responses API request to OpenAI Chat Completions format
 */
export function openaiResponsesToOpenAIRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials: Record<string, unknown>) {
  if (!body.input) return body;

  const result = { ...body } as { messages: Record<string, unknown>[]; [key: string]: unknown };
  result.messages = [];

  if (body.instructions) {
    result.messages.push({ role: ROLE.SYSTEM, content: body.instructions });
  }

  const inputItems = normalizeResponsesInput(body.input as string | Record<string, unknown>[]);
  if (!inputItems) return body;

  const { additionalTools, customToolNames } = convertResponsesInputItems(inputItems as Record<string, unknown>[], result);
  convertResponsesTools(body, additionalTools, customToolNames, result);
  cleanupResponsesFields(result);

  return result;
}

// ── Chat→Responses helpers ──────────────────────────────────────────────────

/**
 * Build a Responses `reasoning` input item from Chat Completions assistant fields.
 * Preserves encrypted blobs needed by store=false multi-turn (Grok CLI / Codex).
 * Returns null when the message has nothing useful to re-send.
 */
function buildReasoningInputItem(msg: Record<string, unknown>): Record<string, unknown> | null {
  if (!msg || typeof msg !== "object") return null;

  const encrypted =
    (typeof msg.encrypted_content === "string" && msg.encrypted_content) ||
    (typeof msg.reasoning_encrypted_content === "string" && msg.reasoning_encrypted_content) ||
    (typeof (msg.reasoning as Record<string, unknown>)?.encrypted_content === "string" && (msg.reasoning as Record<string, unknown>).encrypted_content) ||
    "";

  let summaryText = "";
  if (typeof msg.reasoning_content === "string" && (msg.reasoning_content as string).trim()) {
    summaryText = msg.reasoning_content as string;
  } else if (typeof msg.reasoning === "string" && (msg.reasoning as string).trim()) {
    summaryText = msg.reasoning as string;
  } else if (Array.isArray(msg.reasoning_details)) {
    summaryText = (msg.reasoning_details as Record<string, unknown>[])
      .map((d: Record<string, unknown>) => (typeof d?.text === "string" ? d.text : typeof d?.content === "string" ? d.content : ""))
      .filter(Boolean)
      .join("\n");
  }

  if (!encrypted && !summaryText) return null;

  const item: Record<string, unknown> = { type: RESPONSES_ITEM.REASONING };
  if (summaryText) {
    item.summary = [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: summaryText }];
  }
  if (encrypted) item.encrypted_content = encrypted;
  return item;
}

/** Convert a single Chat Completions message's content to Responses API content parts */
function convertChatMessageContent(msg: Record<string, unknown>, contentType: string): Record<string, unknown>[] {
  if (typeof msg.content === "string") {
    return [{ type: contentType, text: msg.content }];
  }
  if (!Array.isArray(msg.content)) return [];
  return (msg.content as Record<string, unknown>[]).map((c: Record<string, unknown>) => {
    if (c.type === OPENAI_BLOCK.TEXT) return { type: contentType, text: c.text };
    if (c.type === OPENAI_BLOCK.IMAGE_URL) {
      const imgObj = c.image_url as Record<string, unknown> | string | undefined;
      const url = typeof imgObj === "string" ? imgObj : imgObj?.url;
      return { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: url, detail: (imgObj as Record<string, unknown>)?.detail || "auto" };
    }
    if (c.type === RESPONSES_ITEM.INPUT_IMAGE) return c;
    const text = c.text || c.content || JSON.stringify(c);
    return { type: contentType, text: typeof text === "string" ? text : JSON.stringify(text) };
  });
}

/** Convert tool result message to Responses API function_call_output */
function convertToolResultMessage(msg: Record<string, unknown>): Record<string, unknown> {
  const output = typeof msg.content === "string"
    ? msg.content
    : Array.isArray(msg.content)
      ? (msg.content as Record<string, unknown>[]).map((c: Record<string, unknown>) => c.text || JSON.stringify(c)).join("")
      : JSON.stringify(msg.content);
  return {
    type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
    call_id: clampCallId(msg.tool_call_id),
    output
  };
}

/** Convert Chat Completions messages to Responses API input items */
function convertMessagesToResponsesInput(
  messages: Record<string, unknown>[],
  result: { input: Record<string, unknown>[]; instructions?: string; [key: string]: unknown },
): boolean {
  let hasSystemMessage = false;

  for (const msg of messages) {
    if (msg.role === ROLE.SYSTEM || msg.role === ROLE.DEVELOPER) {
      if (!hasSystemMessage) {
        result.instructions = typeof msg.content === "string" ? msg.content : "";
        hasSystemMessage = true;
      }
      continue;
    }

    if (msg.role === ROLE.USER || msg.role === ROLE.ASSISTANT) {
      if (msg.role === ROLE.ASSISTANT) {
        const reasoningItem = buildReasoningInputItem(msg);
        if (reasoningItem) result.input.push(reasoningItem);
      }

      const contentType = msg.role === ROLE.USER ? RESPONSES_ITEM.INPUT_TEXT : RESPONSES_ITEM.OUTPUT_TEXT;
      const content = convertChatMessageContent(msg, contentType);
      if (content.length > 0) {
        result.input.push({ type: RESPONSES_ITEM.MESSAGE, role: msg.role, content });
      }
    }

    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      for (const tc of msg.tool_calls as Record<string, unknown>[]) {
        const fn = tc.function as Record<string, unknown> | undefined;
        result.input.push({
          type: RESPONSES_ITEM.FUNCTION_CALL,
          call_id: clampCallId(tc.id),
          name: fn?.name || "_unknown",
          arguments: fn?.arguments || "{}"
        });
      }
    }

    if (msg.role === ROLE.TOOL) {
      result.input.push(convertToolResultMessage(msg));
    }
  }

  return hasSystemMessage;
}

/** Convert Chat Completions tools to Responses API format */
function convertToolsToResponsesFormat(body: Record<string, unknown>, result: Record<string, unknown>) {
  if (!body.tools || !Array.isArray(body.tools)) return;
  result.tools = (body.tools as Record<string, unknown>[]).map((tool: Record<string, unknown>) => {
    if (tool.type === OPENAI_BLOCK.FUNCTION) {
      const fn = tool.function as Record<string, unknown>;
      return {
        type: OPENAI_BLOCK.FUNCTION,
        name: fn.name,
        description: String(fn.description || ""),
        parameters: normalizeToolParameters(fn.parameters),
        strict: fn.strict
      };
    }
    return tool;
  });
}

/** Pass through relevant Chat Completions fields to Responses API */
function passthroughResponseFields(body: Record<string, unknown>, result: Record<string, unknown>) {
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.max_tokens !== undefined) result.max_tokens = body.max_tokens;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.reasoning !== undefined) result.reasoning = body.reasoning;
  if (body.reasoning_effort !== undefined) result.reasoning = { effort: body.reasoning_effort, summary: "auto" };
  if (body.service_tier !== undefined) result.service_tier = body.service_tier;
  if (body.prompt_cache_key !== undefined) result.prompt_cache_key = body.prompt_cache_key;
}

/**
 * Convert OpenAI Chat Completions to OpenAI Responses API format
 */
export function openaiToOpenAIResponsesRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials: Record<string, unknown>) {
  if (body.input) return { ...body, model, stream: true };

  const result: { input: Record<string, unknown>[]; [key: string]: unknown } = {
    model,
    input: [],
    stream: true,
    store: false
  };

  const messages = (body.messages || []) as Record<string, unknown>[];
  const hasSystem = convertMessagesToResponsesInput(messages, result);
  if (!hasSystem) result.instructions = "";

  convertToolsToResponsesFormat(body, result);
  passthroughResponseFields(body, result);

  return result;
}

// Register both directions
register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, openaiResponsesToOpenAIRequest as unknown as Parameters<typeof register>[2], null);
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, openaiToOpenAIResponsesRequest as unknown as Parameters<typeof register>[2], null);
