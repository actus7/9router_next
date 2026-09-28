// Ollama /api/chat request → OpenAI chat body, so the gateway can route it like
// any other chat. Spec: https://github.com/ollama/ollama/blob/main/docs/api.md
type Json = Record<string, unknown>;

/** Ollama sampling knobs live under `options`; OpenAI puts them top-level. */
const OPTION_TO_OPENAI: Record<string, string> = {
  temperature: "temperature",
  top_p: "top_p",
  num_predict: "max_tokens",
  stop: "stop",
  seed: "seed",
  presence_penalty: "presence_penalty",
  frequency_penalty: "frequency_penalty",
};

/** Ollama images are bare base64; OpenAI wants a data URL with the right mime. */
function imageUrl(image: string): string {
  if (/^(data:|https?:)/.test(image)) return image;
  const mime = image.startsWith("/9j/") ? "image/jpeg"
    : image.startsWith("R0lG") ? "image/gif"
    : image.startsWith("UklGR") ? "image/webp"
    : "image/png";
  return `data:${mime};base64,${image}`;
}

function responseFormat(format: unknown): Json | undefined {
  if (format === "json") return { type: "json_object" };
  if (format && typeof format === "object") return { type: "json_schema", json_schema: { name: "response", schema: format } };
  return undefined;
}

/**
 * Ollama's history has no tool call ids: an assistant turn carries calls with
 * object arguments and the answer comes back as `role: "tool"` + `tool_name`.
 * OpenAI rejects a tool message whose `tool_call_id` matches no call, so ids are
 * minted here and each tool result is paired with the pending call of the same
 * name (or the oldest one, when the client did not send a name).
 */
function toOpenAIMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  let pending: { id: string; name: unknown }[] = [];
  let seq = 0;
  return messages.map((raw: Json) => {
    const { images, thinking: _thinking, tool_name: _toolName, ...message } = raw;
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      const calls = (message.tool_calls as Json[]).map((call) => {
        const fn = (call.function ?? {}) as Json;
        const args = fn.arguments;
        return {
          id: typeof call.id === "string" ? call.id : `call_${seq++}`,
          type: "function",
          function: { name: fn.name, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) },
        };
      });
      pending = calls.map((c) => ({ id: c.id, name: c.function.name }));
      return { ...message, content: message.content ?? "", tool_calls: calls };
    }
    if (message.role === "tool") {
      const byName = pending.findIndex((p) => p.name === raw.tool_name);
      const [match] = pending.splice(byName >= 0 ? byName : 0, 1);
      return { ...message, tool_call_id: message.tool_call_id ?? match?.id ?? `call_${seq++}` };
    }
    if (Array.isArray(images) && images.length > 0) {
      return {
        ...message,
        content: [
          { type: "text", text: typeof message.content === "string" ? message.content : "" },
          ...(images as string[]).map((image) => ({ type: "image_url", image_url: { url: imageUrl(image) } })),
        ],
      };
    }
    return message;
  });
}

export function ollamaChatToOpenAI(body: Json): Json {
  // keep_alive/think are Ollama runtime controls with no gateway equivalent.
  const { options, format, messages, keep_alive: _keepAlive, think: _think, ...rest } = body;
  // Ollama streams unless told otherwise; OpenAI is the opposite, so the
  // default has to be made explicit before the body crosses over.
  const stream = body.stream !== false;
  const out: Json = { ...rest, stream, messages: toOpenAIMessages(messages) };
  // Without it an OpenAI stream carries no usage and eval_count would be 0.
  if (stream) out.stream_options = { include_usage: true };
  if (options && typeof options === "object") {
    for (const [key, value] of Object.entries(options as Json)) {
      const target = OPTION_TO_OPENAI[key];
      if (target && value !== undefined) out[target] = value;
    }
  }
  const rf = responseFormat(format);
  if (rf) out.response_format = rf;
  return out;
}
