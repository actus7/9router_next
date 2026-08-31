import { readAssistantText, textValue } from "../chatFormatUtils";

export interface ChatFetchResult {
  text: string;
  streamed: boolean;
}

/**
 * POST to the chat completions endpoint. If the response is a ReadableStream
 * the SSE chunks are consumed via `onStreamText`; otherwise the JSON body is
 * returned as a single fallback text.
 */
export async function executeChatFetch(
  url: string,
  fetchOptions: RequestInit,
  onStreamText: (text: string) => void,
): Promise<ChatFetchResult> {
  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const requestError = new Error(
      textValue(errorData.error || errorData.message || `Request failed (${response.status})`),
    ) as Error & { status?: number };
    requestError.status = response.status;
    throw requestError;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const fallbackText = textValue(
      ((data?.choices as Array<Record<string, unknown>> | undefined)?.[0] as Record<string, unknown> | undefined)
        ?.message || data?.output_text || data?.error || data?.message || "",
    );
    return { text: fallbackText, streamed: false };
  }

  const text = await consumeSSEStream(reader, onStreamText);
  return { text, streamed: true };
}

/** Read an SSE stream, invoking `onText` with the accumulated text on every chunk. */
async function consumeSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onText: (text: string) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  let assistantText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const chunk = JSON.parse(payload);
        const text = readAssistantText(chunk);
        if (!text) continue;

        assistantText += text;
        onText(assistantText);
      } catch {
        // Ignore malformed chunks.
      }
    }
  }

  return assistantText;
}
