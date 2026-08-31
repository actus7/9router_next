import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from "../schema/index";

/**
 * Normalize Responses API input to array format.
 * Accepts string or array, returns array of message items.
 * An empty array is treated like an empty string — providers require at least one user
 * message, so we inject a placeholder rather than forwarding an empty messages[].
 * @param input - raw input from Responses API body
 * @returns normalized array or null if invalid
 */
export function normalizeResponsesInput(input: string | Record<string, unknown>[]) {
  if (typeof input === "string") {
    const text = input.trim() === "" ? "..." : input;
    return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text }] }];
  }
  if (Array.isArray(input)) {
    // Empty input[] would produce messages:[] which all providers reject (#389)
    if (input.length === 0) {
      return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "..." }] }];
    }
    return input;
  }
  return null;
}

/**
 * Convert OpenAI Responses API format to standard chat completions format
 * Responses API uses: { input: [...], instructions: "..." }
 * Chat API uses: { messages: [...] }
 */
function convertResponsesApiFormat(body: Record<string, unknown>) {
  if (!body.input) return body;

  const result: Record<string, unknown> = { ...body };
  const messages: Record<string, unknown>[] = [];

  // Convert instructions to system message
  if (body.instructions) {
    messages.push({ role: ROLE.SYSTEM, content: body.instructions });
  }

  // Group items by conversation turn
  let currentAssistantMsg: Record<string, unknown> | null = null;
  const pendingToolCalls: Record<string, unknown>[] = [];
  let pendingToolResults: Record<string, unknown>[] = [];

  const inputItems = normalizeResponsesInput(body.input as string | Record<string, unknown>[]);
  if (!inputItems) return body;

  for (const item of inputItems as Record<string, unknown>[]) {
    // Determine item type - Droid CLI sends role-based items without 'type' field
    // Fallback: if no type but has role property, treat as message
    const itemType = item.type || (item.role ? RESPONSES_ITEM.MESSAGE : null);

    if (itemType === RESPONSES_ITEM.MESSAGE) {
      // Flush any pending assistant message with tool calls
      if (currentAssistantMsg) {
        messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      // Flush pending tool results
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) {
          messages.push(tr);
        }
        pendingToolResults = [];
      }

      // Convert content: input_text → text, output_text → text, input_image → image_url
      const content = Array.isArray(item.content)
        ? (item.content as Record<string, unknown>[]).map((c: Record<string, unknown>) => {
          if (c.type === RESPONSES_ITEM.INPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
          if (c.type === RESPONSES_ITEM.OUTPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
          if (c.type === RESPONSES_ITEM.INPUT_IMAGE) {
            const url = c.image_url || c.file_id || "";
            return { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url, detail: c.detail || "auto" } };
          }
          return c;
        })
        : item.content;
      messages.push({ role: item.role, content });
    }
    else if (itemType === RESPONSES_ITEM.FUNCTION_CALL) {
      // Start or append to assistant message with tool_calls
      if (!currentAssistantMsg) {
        currentAssistantMsg = {
          role: ROLE.ASSISTANT,
          content: null,
          tool_calls: [] as Record<string, unknown>[]
        };
      }
      // Skip items with empty/missing name — upstream APIs reject nameless tool calls (#444)
      if (!item.name || typeof item.name !== "string" || (item.name as string).trim() === "") continue;
      (currentAssistantMsg.tool_calls as Record<string, unknown>[]).push({
        id: item.call_id,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: item.name,
          arguments: item.arguments
        }
      });
    }
    else if (itemType === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT) {
      // Flush assistant message first if exists
      if (currentAssistantMsg) {
        messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      // Add tool result
      pendingToolResults.push({
        role: ROLE.TOOL,
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output)
      });
    }
    else if (itemType === RESPONSES_ITEM.REASONING) {
      // Skip reasoning items - they are for display only
      continue;
    }
  }

  // Flush remaining
  if (currentAssistantMsg) {
    messages.push(currentAssistantMsg);
  }
  if (pendingToolResults.length > 0) {
    for (const tr of pendingToolResults) {
      messages.push(tr);
    }
  }

  result.messages = messages;

  // Cleanup Responses API specific fields
  delete result.input;
  delete result.instructions;
  delete result.include;
  delete result.prompt_cache_key;
  delete result.store;
  delete result.reasoning;

  return result;
}
