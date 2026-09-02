// Síntese de resposta local sem chamar provider.
// Usada por bypassHandler e synapse para gerar respostas determinísticas.
// Extraído verbatim de bypassHandler.ts — zero mudança de comportamento.

import { translateResponse, initState } from "../translator/index";
import { FORMATS } from "../translator/formats";
import { formatSSE } from "./stream";

const DEFAULT_BYPASS_TEXT = "CLI Command Execution: Clear Terminal";

/**
 * Create OpenAI standard format response
 */
export function createOpenAIResponse(model: string, text = DEFAULT_BYPASS_TEXT) {
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text
      },
      finish_reason: "stop"
    }],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2
    }
  };
}

/**
 * Create OpenAI streaming chunks from complete response
 */
export function createOpenAIStreamingChunks(completeResponse: Record<string, unknown>) {
  const { id, created, model, choices } = completeResponse as { id: string; created: number; model: string; choices: Array<{ message: { content: string } }> };
  const content = choices[0].message.content;

  return [
    // Chunk with content
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{
        index: 0,
        delta: {
          role: "assistant",
          content
        },
        finish_reason: null
      }]
    },
    // Final chunk with finish_reason
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: "stop"
      }],
      usage: completeResponse.usage
    }
  ];
}

/**
 * Create streaming response with translation
 * Use translator to convert OpenAI chunks → sourceFormat
 */
export function createStreamingResponse(sourceFormat: string, model: string, text?: string, extraHeaders?: Record<string, string>) {
  const openaiResponse = createOpenAIResponse(model, text);
  const state = initState(sourceFormat) as Record<string, unknown>;
  state.model = model;

  // Create OpenAI streaming chunks
  const openaiChunks = createOpenAIStreamingChunks(openaiResponse);

  // Translate each chunk to sourceFormat using translator
  const translatedChunks = [];

  for (const chunk of openaiChunks) {
    const translated = translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state);
    if (translated?.length > 0) {
      for (const item of translated) {
        translatedChunks.push(formatSSE(item, sourceFormat));
      }
    }
  }

  // Flush remaining events
  const flushed = translateResponse(FORMATS.OPENAI, sourceFormat, null, state);
  if (flushed?.length > 0) {
    for (const item of flushed) {
      translatedChunks.push(formatSSE(item, sourceFormat));
    }
  }

  // Add [DONE]
  translatedChunks.push("data: [DONE]\n\n");

  return {
    success: true,
    response: new Response(translatedChunks.join(""), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        ...extraHeaders,
      }
    })
  };
}

/**
 * Create non-streaming response with translation
 * Use translator to convert OpenAI → sourceFormat
 */
export function createNonStreamingResponse(sourceFormat: string, model: string, text?: string, extraHeaders?: Record<string, string>) {
  const openaiResponse = createOpenAIResponse(model, text);

  // If sourceFormat is OpenAI, return directly
  if (sourceFormat === FORMATS.OPENAI) {
    return {
      success: true,
      response: new Response(JSON.stringify(openaiResponse), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          ...extraHeaders,
        }
      })
    };
  }

  // Use translator to convert: simulate streaming then collect all chunks
  const state = initState(sourceFormat) as Record<string, unknown>;
  state.model = model;

  const openaiChunks = createOpenAIStreamingChunks(openaiResponse);
  const allTranslated: unknown[] = [];

  for (const chunk of openaiChunks) {
    const translated = translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state);
    if (translated && translated.length > 0) {
      allTranslated.push(...translated);
    }
  }

  // Flush remaining
  const flushed = translateResponse(FORMATS.OPENAI, sourceFormat, null, state);
  if (flushed && flushed.length > 0) {
    allTranslated.push(...flushed);
  }

  // For non-streaming, merge all chunks into final response
  const finalResponse = mergeChunksToResponse(allTranslated, sourceFormat);

  return {
    success: true,
    response: new Response(JSON.stringify(finalResponse), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        ...extraHeaders,
      }
    })
  };
}

/**
 * Merge translated chunks into final response object (for non-streaming)
 * Takes the last complete chunk as the final response
 */
export function mergeChunksToResponse(chunks: unknown[], sourceFormat: string): Record<string, unknown> {
  if (!chunks || chunks.length === 0) {
    return createOpenAIResponse("unknown");
  }

  // For most formats, the last chunk before done contains the complete response
  // Find the most complete chunk (usually the last one with content)
  let finalChunk: Record<string, unknown> = chunks[chunks.length - 1] as Record<string, unknown>;

  // For Claude format, find the message_stop or final message
  if (sourceFormat === FORMATS.CLAUDE) {
    const messageStop = chunks.find((c) => (c as Record<string, unknown>).type === "message_stop");
    if (messageStop) {
      // Reconstruct complete message from chunks
      const messageDelta = chunks.find((c) => (c as Record<string, unknown>).type === "message_delta") as Record<string, unknown> | undefined;
      const messageStart = chunks.find((c) => (c as Record<string, unknown>).type === "message_start") as Record<string, unknown> | undefined;

      if (messageStart?.message) {
        finalChunk = messageStart.message as Record<string, unknown>;
        // message_start.usage has input + cache; message_delta.usage has the
        // final output_tokens. Merge so cache survives (delta omits it).
        const startUsage = (messageStart.message as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
        const deltaUsage = messageDelta?.usage as Record<string, unknown> | undefined;
        if (startUsage || deltaUsage) {
          finalChunk.usage = {
            ...(startUsage || {}),
            ...(deltaUsage || {}),
            ...(startUsage?.cache_read_input_tokens !== undefined
              ? { cache_read_input_tokens: startUsage.cache_read_input_tokens }
              : {}),
            ...(startUsage?.cache_creation_input_tokens !== undefined
              ? { cache_creation_input_tokens: startUsage.cache_creation_input_tokens }
              : {}),
            ...(startUsage?.input_tokens !== undefined
              ? { input_tokens: startUsage.input_tokens }
              : {})
          };
        }
      }
    }
  }

  return finalChunk;
}
