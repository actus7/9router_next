import type { ChatMessage } from "../types";

const CHARS_PER_TOKEN = 4;
/** Used when the model's real context window isn't known client-side. Conservative floor shared by most current-generation chat models. */
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;

export interface ContextUsageEstimate {
  systemPromptTokens: number;
  toolsTokens: number;
  messagesTokens: number;
  totalTokens: number;
  contextWindowTokens: number;
  percentUsed: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Attachments counted as their base64 payload, because that is what is sent.
 *
 * They were not counted at all: the meter summed `content` only, so a
 * conversation carrying several megabytes of images — re-sent on every turn —
 * reported a usage that looked like plain text. Providers bill images by tile
 * rather than by byte, so this is a rough floor, not an accurate figure; being
 * roughly right beats reporting zero for the largest thing in the request.
 */
function attachmentTokens(message: ChatMessage): number {
  if (!Array.isArray(message.attachments)) return 0;
  return message.attachments.reduce(
    (sum, attachment) => sum + estimateTokens(typeof attachment?.dataUrl === "string" ? attachment.dataUrl : ""),
    0,
  );
}

/** Rough (chars/4) client-side estimate of context usage — no real tokenizer is available in the browser. */
export function estimateContextUsage(
  messages: ChatMessage[],
  systemPrompt: string,
  toolsJson: string,
  contextWindowTokens: number = DEFAULT_CONTEXT_WINDOW_TOKENS,
): ContextUsageEstimate {
  const systemPromptTokens = estimateTokens(systemPrompt);
  const toolsTokens = estimateTokens(toolsJson);
  const messagesTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")) + attachmentTokens(m),
    0,
  );
  const totalTokens = systemPromptTokens + toolsTokens + messagesTokens;
  return {
    systemPromptTokens,
    toolsTokens,
    messagesTokens,
    totalTokens,
    contextWindowTokens,
    percentUsed: contextWindowTokens > 0 ? (totalTokens / contextWindowTokens) * 100 : 0,
  };
}
