import { FORMATS } from "../../translator/formats";
import { needsTranslation } from "../../translator/index";
import { fromOpenAIFinish } from "../../translator/concerns/finishReason";
import { ollamaBodyToOpenAI } from "../../translator/response/ollama-to-openai";
import { addBufferToUsage, filterUsageForFormat } from "../../utils/usageTracking";
import { createErrorResult } from "../../utils/error";
import { HTTP_STATUS } from "../../config/runtimeConfig";
import { parseSSEToOpenAIResponse } from "./sseToJsonHandler";
import { buildRequestDetail, extractRequestConfig, extractUsageFromResponse, saveUsageStats, formatDoneLine } from "./requestDetail";
import { saveRequestDetail } from "../../host/usage";
import { summarizeRoutingTrace } from "../../host/routingTrace";
import { getRoutingTrace } from "../../services/routingTrace";
import { decloakToolNames } from "../../utils/claudeCloaking";
import { ROLE, RESPONSES_ITEM } from "../../translator/schema/index";
import type { NonStreamingHandlerContext } from "./types";

// Local types for dynamic JSON structures
interface JsonObject { [key: string]: unknown }

function parseToolArguments(value: unknown): JsonObject {
  if (!value) return {};
  if (typeof value === "object" && value !== null) return value as JsonObject;
  try {
    return JSON.parse(value as string);
  } catch {
    return {};
  }
}

function openAICompletionToClaudeMessage(responseBody: JsonObject): JsonObject {
  if (!responseBody?.choices || !(responseBody.choices as JsonObject[])?.[0]) return responseBody;
  const choice = (responseBody.choices as JsonObject[])[0];
  const message = (choice.message as JsonObject) || {};
  const content: JsonObject[] = [];

  const reasoning = (message.reasoning_content as string) || ((message.provider_specific_fields as JsonObject)?.reasoning_content as string) || "";
  if (reasoning) {
    content.push({ type: "thinking", thinking: reasoning });
  }
  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: "text", text: message.content });
  }
  for (const toolCall of (message.tool_calls as JsonObject[]) || []) {
    const fn = (toolCall.function as JsonObject) || {};
    content.push({
      type: "tool_use",
      id: (toolCall.id as string) || `toolu_${Date.now()}_${content.length}`,
      name: (fn.name as string) || (toolCall.name as string) || "",
      input: parseToolArguments(fn.arguments || toolCall.arguments),
    });
  }
  if (content.length === 0) content.push({ type: "text", text: "" });

  const usage = (responseBody.usage as JsonObject) || {};
  return {
    id: String(responseBody.id || `msg_${Date.now()}`).replace(/^chatcmpl-/, ""),
    type: "message",
    role: "assistant",
    model: responseBody.model || "unknown",
    content,
    stop_reason: fromOpenAIFinish(choice.finish_reason as string, FORMATS.CLAUDE),
    stop_sequence: null,
    usage: {
      input_tokens: (usage.prompt_tokens as number) || (usage.input_tokens as number) || 0,
      output_tokens: (usage.completion_tokens as number) || (usage.output_tokens as number) || 0,
    },
  };
}

/**
 * Convert an OpenAI Chat Completions non-streaming response body into the
 * OpenAI Responses API shape. Used when a Responses-format client (e.g. Codex)
 * is routed to a Chat Completions upstream and `stream:false` — the streaming
 * path already emits Responses events, but the JSON path returned a raw
 * `chat.completion` body, so tool_calls were invisible to Responses clients.
 */
function extractCustomToolInput(argumentsValue: unknown): string {
  const argumentsText = typeof argumentsValue === "string" ? argumentsValue : JSON.stringify(argumentsValue || {});
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && typeof parsed.input === "string") return parsed.input;
  } catch { /* raw freeform input */ }
  return argumentsText;
}

function openAICompletionToResponses(responseBody: JsonObject, customToolNames: string[] | null = null): JsonObject {
  const choice = (responseBody.choices as JsonObject[])?.[0];
  if (!choice) return responseBody;

  const message = (choice.message as JsonObject) || {};
  const output: JsonObject[] = [];

  // Reasoning → a reasoning item (summary text), mirroring the streaming path.
  const reasoning = (message.reasoning_content as string) || (message.reasoning as string);
  if (typeof reasoning === "string" && reasoning.length > 0) {
    output.push({
      type: RESPONSES_ITEM.REASONING,
      summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: reasoning }],
    });
  }

  // Assistant text → a message item with output_text content.
  const text = typeof message.content === "string" ? message.content : "";
  if (text.length > 0) {
    output.push({
      type: RESPONSES_ITEM.MESSAGE,
      role: ROLE.ASSISTANT,
      content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text, annotations: [] }],
    });
  }

  // tool_calls → function_call/custom_tool_call items (Responses-native tool shape).
  for (const tc of (message.tool_calls as JsonObject[]) || []) {
    const fn = (tc.function as JsonObject) || {};
    const custom = customToolNames?.includes(fn.name as string);
    output.push({
      type: custom ? RESPONSES_ITEM.CUSTOM_TOOL_CALL : RESPONSES_ITEM.FUNCTION_CALL,
      id: `${custom ? "ctc" : "fc"}_${tc.id || ""}`,
      call_id: tc.id || "",
      name: fn.name || "",
      ...(custom
        ? { input: extractCustomToolInput(fn.arguments) }
        : { arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {}) }),
    });
  }

  const usage = (responseBody.usage as JsonObject) || {};
  const status = choice.finish_reason === "tool_calls" ? "completed" : (choice.finish_reason === "stop" ? "completed" : (choice.finish_reason || "completed"));

  return {
    id: `resp_${responseBody.id || ""}`.replace(/^resp_chatcmpl-/, "resp_"),
    object: "response",
    created_at: responseBody.created || Math.floor(Date.now() / 1000),
    model: responseBody.model || "unknown",
    status,
    background: false,
    error: null,
    output,
    usage: {
      input_tokens: (usage.prompt_tokens as number) || (usage.input_tokens as number) || 0,
      output_tokens: (usage.completion_tokens as number) || (usage.output_tokens as number) || 0,
      total_tokens: (usage.total_tokens as number) || ((usage.prompt_tokens as number) || 0) + ((usage.completion_tokens as number) || 0),
    },
  };
}

/**
 * Translate non-streaming response body from provider format → OpenAI format.
 */
function translateNonStreamingResponse(responseBody: JsonObject, targetFormat: string, sourceFormat: string, customToolNames: string[] | null = null): JsonObject {
  if (targetFormat === sourceFormat) return responseBody;
  // Provider responded in OpenAI Chat Completions shape but the client speaks
  // Responses API — convert so tool_calls/text surface as Responses `output`.
  if (targetFormat === FORMATS.OPENAI && sourceFormat === FORMATS.OPENAI_RESPONSES) {
    return openAICompletionToResponses(responseBody, customToolNames);
  }
  if (targetFormat === FORMATS.OPENAI && sourceFormat === FORMATS.CLAUDE) {
    return openAICompletionToClaudeMessage(responseBody);
  }
  if (targetFormat === FORMATS.OPENAI) return responseBody;

  // Gemini / Antigravity
  if (targetFormat === FORMATS.GEMINI || targetFormat === FORMATS.ANTIGRAVITY || targetFormat === FORMATS.GEMINI_CLI || targetFormat === FORMATS.VERTEX) {
    const response = (responseBody.response as JsonObject) || responseBody;
    if (!response?.candidates || !(response.candidates as JsonObject[])?.[0]) return responseBody;

    const candidate = (response.candidates as JsonObject[])[0];
    const content = candidate.content as JsonObject;
    const usage = (response.usageMetadata as JsonObject) || (responseBody.usageMetadata as JsonObject);
    let textContent = "", reasoningContent = "";
    const toolCalls: JsonObject[] = [];

    if (content?.parts) {
      for (const part of content.parts as JsonObject[]) {
        if (part.thought === true && part.text) reasoningContent += part.text as string;
        else if (part.text !== undefined) textContent += part.text as string;
        if (part.functionCall) {
          const fc = part.functionCall as JsonObject;
          toolCalls.push({
            id: `call_${fc.name}_${Date.now()}_${toolCalls.length}`,
            type: "function",
            function: { name: fc.name, arguments: JSON.stringify(fc.args || {}) }
          });
        }
        // Handle inline image data (from image generation models)
        const inlineData = (part.inlineData as JsonObject) || (part.inline_data as JsonObject);
        if (inlineData?.data) {
          const mimeType = (inlineData.mimeType as string) || (inlineData.mime_type as string) || "image/png";
          textContent += `\n![image](data:${mimeType};base64,${inlineData.data})\n`;
        }
      }
    }

    const message: JsonObject = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (reasoningContent) message.reasoning_content = reasoningContent;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    let finishReason = ((candidate.finishReason as string) || "stop").toLowerCase();
    if (finishReason === "stop" && toolCalls.length > 0) finishReason = "tool_calls";

    const result: JsonObject = {
      id: `chatcmpl-${response.responseId || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(new Date((response.createTime as string) || Date.now()).getTime() / 1000),
      model: response.modelVersion || "gemini",
      choices: [{ index: 0, message, finish_reason: finishReason }]
    };

    if (usage) {
      result.usage = {
        prompt_tokens: ((usage.promptTokenCount as number) || 0) + ((usage.thoughtsTokenCount as number) || 0),
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0
      };
      if ((usage.thoughtsTokenCount as number) > 0) {
        (result.usage as JsonObject).completion_tokens_details = { reasoning_tokens: usage.thoughtsTokenCount };
      }
    }
    return result;
  }

  // Claude
  if (targetFormat === FORMATS.CLAUDE) {
    // Always translate a Claude-format body to OpenAI, even if `content` is
    // missing/null (e.g. M3 with max_tokens:1 spends the budget on thinking
    // and returns `content: null`). Returning the raw body would leave the
    // OpenAI client without a `choices` array and surface as a UI test error.
    // Early return if the response is already in OpenAI format (has choices array)
    // or if it has content as a non-array value (likely a different non-Claude format).
    // Some providers (e.g. xiaomi-tokenplan) return OpenAI-format responses even when
    // the request was translated to Claude format — the targetFormat is Claude but the
    // actual response is OpenAI-native and needs no further translation.
    if (responseBody.choices || (responseBody.content && !Array.isArray(responseBody.content))) return responseBody;

    let textContent = "", thinkingContent = "";
    const toolCalls: JsonObject[] = [];

    for (const block of (responseBody.content as JsonObject[]) || []) {
      if (block.type === "text") {
        // Strip markdown code block markers (e.g. kimi wraps JSON in ```json...```)
        const raw = (block.text as string) ?? "";
        const text = raw.replace(/^\s*```\s*json\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
        textContent += text;
      } else if (block.type === "thinking") thinkingContent += (block.thinking as string) || "";
      else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input || {}) } });
      }
    }

    const message: JsonObject = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (thinkingContent) message.reasoning_content = thinkingContent;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    let finishReason = (responseBody.stop_reason as string) || "stop";
    if (finishReason === "end_turn") finishReason = "stop";
    if (finishReason === "tool_use") finishReason = "tool_calls";

    const result: JsonObject = {
      id: `chatcmpl-${responseBody.id || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: responseBody.model || "claude",
      choices: [{ index: 0, message, finish_reason: finishReason }]
    };

    if (responseBody.usage) {
      const usage = responseBody.usage as JsonObject;
      result.usage = {
        prompt_tokens: (usage.input_tokens as number) || 0,
        completion_tokens: (usage.output_tokens as number) || 0,
        total_tokens: ((usage.input_tokens as number) || 0) + ((usage.output_tokens as number) || 0)
      };
    }
    return result;
  }

  // Ollama
  if (targetFormat === FORMATS.OLLAMA) {
    return ollamaBodyToOpenAI(responseBody) as JsonObject;
  }

  return responseBody;
}

/**
 * Handle non-streaming response from provider.
 */
/**
 * The routing summary for this request, read off the trace that rides the body.
 * Stored on the always-written usage row because the full trace only travels on
 * a response header and `requestDetails` is opt-in — so with observability off,
 * nothing recorded why a request routed where it did.
 */
function routingMeta(body: unknown): Record<string, unknown> | undefined {
  const summary = summarizeRoutingTrace(getRoutingTrace(body as Record<string, unknown>));
  return summary ? { routing: summary } : undefined;
}

export async function handleNonStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, customToolNames, trackDone, appendLog, pxpipe, reqTag, log }: NonStreamingHandlerContext) {
  trackDone();
  const contentType = providerResponse.headers.get("content-type") || "";
  let responseBody: JsonObject;

  if (contentType.includes("text/event-stream")) {
    const sseText = await providerResponse.text();
    const parsed = parseSSEToOpenAIResponse(sseText, model);
    if (!parsed) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");
    }
    responseBody = parsed as JsonObject;
  } else {
    try {
      responseBody = await providerResponse.json() as JsonObject;
    } catch (err: unknown) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      console.error(`[ChatCore] Failed to parse JSON from ${provider}:`, (err as Error).message);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
    }
  }

  reqLogger.logProviderResponse(providerResponse.status, providerResponse.statusText, providerResponse.headers, responseBody);
  if (onRequestSuccess) {
    Promise.resolve()
      .then(onRequestSuccess)
      .catch((err: unknown) => {
        console.error("[ChatCore] onRequestSuccess failed:", (err as Error)?.message || err);
      });
  }

  // Decloak tool_use names once on raw Claude body, before any translation (INPUT side)
  responseBody = decloakToolNames(responseBody, toolNameMap as Map<string, string>) as JsonObject;

  const usage = extractUsageFromResponse(responseBody);
  appendLog({ tokens: usage, status: "200 OK" });
  saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, silent: true, meta: routingMeta(body) });
  if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime } }));

  const translatedResponse = needsTranslation(targetFormat, sourceFormat)
    ? translateNonStreamingResponse(responseBody, targetFormat, sourceFormat, customToolNames)
    : responseBody;
  const isClaudeMessageResponse = sourceFormat === FORMATS.CLAUDE && translatedResponse?.type === "message";
  // Responses-format translation produces a `object:"response"` body with no
  // `choices`; skip the Chat-Completions-specific post-processing below for it.
  const isResponsesResponse = sourceFormat === FORMATS.OPENAI_RESPONSES && translatedResponse?.object === "response";

  // Fix finish_reason for tool_calls: some providers return non-standard values (e.g. "other")
  if ((translatedResponse?.choices as JsonObject[])?.[0]) {
    const choice = (translatedResponse.choices as JsonObject[])[0];
    const msg = choice.message as JsonObject;
    const hasToolCalls = Array.isArray(msg?.tool_calls) && (msg.tool_calls as JsonObject[]).length > 0;
    if (hasToolCalls && choice.finish_reason !== "tool_calls") {
      choice.finish_reason = "tool_calls";
    }
  }

  // Ensure OpenAI-required fields
  if (!isClaudeMessageResponse && !isResponsesResponse) {
    if (!translatedResponse.object) translatedResponse.object = "chat.completion";
    if (!translatedResponse.created) translatedResponse.created = Math.floor(Date.now() / 1000);
  }

  // Strip Azure-specific fields
  if (!isClaudeMessageResponse && !isResponsesResponse) {
    delete translatedResponse.prompt_filter_results;
    if (translatedResponse?.choices) {
      for (const choice of translatedResponse.choices as JsonObject[]) delete choice.content_filter_results;
    }
  }

  if (translatedResponse?.usage) {
    translatedResponse.usage = filterUsageForFormat(addBufferToUsage(translatedResponse.usage as Record<string, unknown>), sourceFormat);
  }

  // Strip reasoning_content only when content is non-empty.
  // When content is empty (e.g. thinking models that used all tokens for reasoning),
  // reasoning_content is the only useful output and must be preserved.
  if (!isClaudeMessageResponse && !isResponsesResponse && translatedResponse?.choices) {
    for (const choice of translatedResponse.choices as JsonObject[]) {
      const msg = choice?.message as JsonObject;
      if (msg?.reasoning_content && msg.content) {
        delete msg.reasoning_content;
      }
    }
  }

  reqLogger.logConvertedResponse(translatedResponse);

  const totalLatency = Date.now() - requestStartTime;
  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: totalLatency, total: totalLatency },
    tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: responseBody || null,
    response: {
      content: ((translatedResponse?.choices as JsonObject[])?.[0]?.message as JsonObject)?.content || translatedResponse?.content || null,
      thinking: ((translatedResponse?.choices as JsonObject[])?.[0]?.message as JsonObject)?.reasoning_content || translatedResponse?.reasoning_content || null,
      finish_reason: ((translatedResponse?.choices as JsonObject[])?.[0]?.finish_reason as string) || "unknown"
    },
    pxpipe,
    status: "success"
  }, { endpoint: clientRawRequest?.endpoint || null })).catch((err: unknown) => {
    console.error("[RequestDetail] Failed to save:", (err as Error).message);
  });

  return {
    success: true,
    response: new Response(JSON.stringify(translatedResponse), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    })
  };
}
