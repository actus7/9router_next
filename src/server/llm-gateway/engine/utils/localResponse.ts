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
function createOpenAIResponse(model: string, text = DEFAULT_BYPASS_TEXT) {
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

function createClaudeMessage(model: string, text: string) {
  return {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function createResponsesObject(model: string, text: string) {
  const id = `resp_${Date.now()}`;
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    error: null,
    output: [{
      id: `msg_${id}_0`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", annotations: [], text }],
    }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
}

/**
 * Create OpenAI streaming chunks from complete response
 */
function createOpenAIStreamingChunks(completeResponse: Record<string, unknown>) {
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

  // O flush de openai→openai devolve [null]; serializado virava `data: null`,
  // que o SDK da OpenAI parseia e quebra lendo `chunk.choices`.
  for (const chunk of [...openaiChunks, null]) {
    const translated = translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state);
    for (const item of translated || []) {
      if (item) translatedChunks.push(formatSSE(item, sourceFormat));
    }
  }

  // Mesma regra do streaming real (clientExpectsDoneSentinel em stream.ts):
  // só a família OpenAI termina com o sentinela.
  if (sourceFormat === FORMATS.OPENAI || sourceFormat === FORMATS.OPENAI_RESPONSES) {
    translatedChunks.push("data: [DONE]\n\n");
  }

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

  // Claude e Responses: o objeto final é montado direto. Mesclar os chunks
  // traduzidos pegava o `message_start` (content vazio, stop_reason null) e,
  // no Responses, o envelope SSE `{event, data}` em vez do `response`.
  const direct = sourceFormat === FORMATS.OPENAI
    ? openaiResponse
    : sourceFormat === FORMATS.CLAUDE
      ? createClaudeMessage(model, openaiResponse.choices[0].message.content)
      : sourceFormat === FORMATS.OPENAI_RESPONSES
        ? createResponsesObject(model, openaiResponse.choices[0].message.content)
        : null;
  if (direct) {
    return {
      success: true,
      response: new Response(JSON.stringify(direct), {
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
  const finalResponse = mergeChunksToResponse(allTranslated);

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

/** Merge translated chunks into final response object (Gemini-family and
 * other formats): the last translated chunk carries the complete response. */
function mergeChunksToResponse(chunks: unknown[]): Record<string, unknown> {
  if (!chunks || chunks.length === 0) {
    return createOpenAIResponse("unknown");
  }
  return chunks[chunks.length - 1] as Record<string, unknown>;
}
