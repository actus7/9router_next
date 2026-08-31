import { register } from "../registry";
import { FORMATS } from "../formats";
import { adjustMaxTokens } from "../formats/maxTokens";
import { encodeDataUri } from "../concerns/image";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index";
import { collapseTextParts } from "../concerns/message";

function stripAnthropicBillingHeader(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.replace(/^x-anthropic-billing-header:[^\n]*(?:\r?\n)?/i, "");
}

// Convert Claude request to OpenAI format
export function claudeToOpenAIRequest(model: string, body: Record<string, unknown>, stream: boolean) {
  const result: { messages: Record<string, unknown>[]; [key: string]: unknown } = {
    model: model,
    messages: [],
    stream: stream
  };

  // Max tokens
  if (body.max_tokens) {
    result.max_tokens = adjustMaxTokens(body);
  }

  // Temperature
  if (body.temperature !== undefined) {
    result.temperature = body.temperature;
  }

  // System message
  if (body.system) {
    const systemContent = Array.isArray(body.system)
      ? (body.system as Record<string, unknown>[]).map((s: Record<string, unknown>) => stripAnthropicBillingHeader(s.text || "")).filter(Boolean).join("\n")
      : stripAnthropicBillingHeader(body.system);
    
    if (systemContent) {
      result.messages.push({
        role: ROLE.SYSTEM,
        content: systemContent
      });
    }
  }

  // Convert messages
  if (body.messages && Array.isArray(body.messages)) {
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i] as Record<string, unknown>;
      const converted = convertClaudeMessage(msg);
      if (converted) {
        // Handle array of messages (multiple tool results)
        if (Array.isArray(converted)) {
          result.messages.push(...converted);
        } else {
          result.messages.push(converted);
        }
      }
    }
  }

  // Fix missing tool responses - OpenAI requires every tool_call to have a response.
  // Local variant: scans contiguous tool replies + inserts "[No response received]"
  // (distinct from the global immediate-next check in concerns/toolCall, runs on the openai leg).
  fixMissingToolResponsesOpenAI(result.messages);

  // Tools
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = (body.tools as Record<string, unknown>[]).map((tool: Record<string, unknown>) => ({
      type: OPENAI_BLOCK.FUNCTION,
      function: {
        name: tool.name,
        description: String(tool.description || ""),
        parameters: tool.input_schema || { type: "object", properties: {} }
      }
    }));
  }

  // Tool choice
  if (body.tool_choice) {
    result.tool_choice = convertToolChoice(body.tool_choice);
  }

  if (body.reasoning_effort !== undefined) {
    result.reasoning_effort = body.reasoning_effort;
  } else if ((body.reasoning as Record<string, unknown>)?.effort !== undefined) {
    result.reasoning_effort = (body.reasoning as Record<string, unknown>).effort;
  }

  if (body.reasoning !== undefined) {
    result.reasoning = body.reasoning;
  }

  return result;
}

// Fix missing tool responses - add empty responses for tool_calls without responses
function fixMissingToolResponsesOpenAI(messages: Record<string, unknown>[]) {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls && (msg.tool_calls as unknown[]).length > 0) {
      const toolCallIds = (msg.tool_calls as Record<string, unknown>[]).map((tc: Record<string, unknown>) => tc.id);
      
      // Collect all tool response IDs that IMMEDIATELY follow this assistant message
      const respondedIds = new Set();
      let insertPosition = i + 1;
      for (let j = i + 1; j < messages.length; j++) {
        const nextMsg = messages[j];
        if (nextMsg.role === ROLE.TOOL && nextMsg.tool_call_id) {
          respondedIds.add(nextMsg.tool_call_id);
          insertPosition = j + 1;
        } else {
          break;
        }
      }
      
      // Find missing responses and insert them
      const missingIds = toolCallIds.filter((id: unknown) => !respondedIds.has(id));
      
      if (missingIds.length > 0) {
        const missingResponses = missingIds.map((id: unknown) => ({
          role: ROLE.TOOL,
          tool_call_id: id,
          content: "[No response received]"
        }));
        messages.splice(insertPosition, 0, ...missingResponses);
        i = insertPosition + missingResponses.length - 1;
      }
    }
  }
}

// Wrap mid-conversation system text so it ends as a user turn (avoids Anthropic prefill 400).
// Uses <instructions> tags that Claude models treat as authoritative directives.
function systemReminderText(content: unknown): string {
  const parts = Array.isArray(content)
    ? (content as Record<string, unknown>[]).filter((c: Record<string, unknown>) => c?.type === CLAUDE_BLOCK.TEXT).map((c: Record<string, unknown>) => (c.text as string) || "")
    : [typeof content === "string" ? content : ""];
  const text = parts.filter(Boolean).join("\n");
  if (!text.trim()) return "";
  return `<instructions>\n${text}\n</instructions>`;
}

// Convert single Claude message - returns single message or array of messages
function convertClaudeMessage(msg: Record<string, unknown>): Record<string, unknown> | Record<string, unknown>[] | null {
  // Mid-conversation system message -> user (per Anthropic placement rules)
  if (msg.role === ROLE.SYSTEM) {
    const text = systemReminderText(msg.content);
    return text ? { role: ROLE.USER, content: text } : null;
  }

  const role = msg.role === ROLE.USER || msg.role === ROLE.TOOL ? ROLE.USER : ROLE.ASSISTANT;
  
  // Simple string content
  if (typeof msg.content === "string") {
    return { role, content: msg.content };
  }

  // Array content
  if (Array.isArray(msg.content)) {
    const parts: Record<string, unknown>[] = [];
    const toolCalls: Record<string, unknown>[] = [];
    const toolResults: Record<string, unknown>[] = [];

    for (const block of msg.content as Record<string, unknown>[]) {
      switch (block.type) {
        case CLAUDE_BLOCK.TEXT:
          parts.push({ type: OPENAI_BLOCK.TEXT, text: block.text });
          break;

        case CLAUDE_BLOCK.IMAGE:
          if ((block.source as Record<string, unknown>)?.type === "base64") {
            const source = block.source as Record<string, unknown>;
            parts.push({
              type: OPENAI_BLOCK.IMAGE_URL,
              image_url: {
                url: encodeDataUri(source.media_type as string, source.data as string)
              }
            });
          }
          break;

        case CLAUDE_BLOCK.TOOL_USE:
          toolCalls.push({
            id: block.id,
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {})
            }
          });
          break;

        case CLAUDE_BLOCK.TOOL_RESULT:
          let resultContent = "";
          if (typeof block.content === "string") {
            resultContent = block.content;
          } else if (Array.isArray(block.content)) {
            resultContent = (block.content as Record<string, unknown>[])
              .filter((c: Record<string, unknown>) => c.type === CLAUDE_BLOCK.TEXT)
              .map((c: Record<string, unknown>) => c.text)
              .join("\n") || JSON.stringify(block.content);
          } else if (block.content) {
            resultContent = JSON.stringify(block.content);
          }
          
          toolResults.push({
            role: ROLE.TOOL,
            tool_call_id: block.tool_use_id,
            content: resultContent
          });
          break;
      }
    }

    // If has tool results, return array of tool messages
    if (toolResults.length > 0) {
      if (parts.length > 0) {
        return [...toolResults, { role: ROLE.USER, content: collapseTextParts(parts) }];
      }
      return toolResults;
    }

    // If has tool calls, return assistant message with tool_calls
    if (toolCalls.length > 0) {
      const result: Record<string, unknown> = { role: ROLE.ASSISTANT };
      if (parts.length > 0) {
        result.content = collapseTextParts(parts);
      }
      result.tool_calls = toolCalls;
      return result;
    }

    // Return content
    if (parts.length > 0) {
      return {
        role,
        content: collapseTextParts(parts)
      };
    }
    
    // Empty content array
    if ((msg.content as unknown[]).length === 0) {
      return { role, content: "" };
    }
  }

  return null;
}

// Convert tool choice
function convertToolChoice(choice: unknown): unknown {
  if (!choice) return "auto";
  if (typeof choice === "string") return choice;
  
  const choiceObj = choice as Record<string, unknown>;
  switch (choiceObj.type) {
    case "auto": return "auto";
    case "any": return "required";
    case "tool": return { type: OPENAI_BLOCK.FUNCTION, function: { name: (choiceObj as Record<string, unknown>).name } };
    default: return "auto";
  }
}

// Register
register(FORMATS.CLAUDE, FORMATS.OPENAI, claudeToOpenAIRequest, null);
