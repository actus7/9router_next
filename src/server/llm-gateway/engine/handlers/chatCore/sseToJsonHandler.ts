import { convertResponsesStreamToJson } from "../../transformer/streamToJsonConverter";
import { createErrorResult } from "../../utils/error";
import { HTTP_STATUS } from "../../config/runtimeConfig";
import { FORMATS } from "../../translator/formats";
import { PROVIDERS } from "../../config/providers";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail";
import { ROLE, RESPONSES_ITEM } from "../../translator/schema/index";
import type { ForcedSSEToJsonContext } from "./types";

// Local types for dynamic JSON structures
interface JsonObject { [key: string]: unknown }

// Responses-API providers (e.g. codex) may emit SSE without content-type + use Responses output shape
const isResponsesProvider = (p: string): boolean => (PROVIDERS[p] as Record<string, unknown>)?.format === FORMATS.OPENAI_RESPONSES;
import { saveRequestDetail } from "../../host/usage";

function textFromResponsesMessageItem(item: unknown): string {
  if (!(item as Record<string, unknown>)?.content || !Array.isArray((item as Record<string, unknown>).content)) return "";
  const byType = ((item as Record<string, unknown>).content as Array<Record<string, unknown>>).find((c) => c.type === "output_text");
  if (typeof byType?.text === "string") return byType.text;
  const anyText = ((item as Record<string, unknown>).content as Array<Record<string, unknown>>).find((c) => typeof c.text === "string");
  if (typeof anyText?.text === "string") return anyText.text;
  return "";
}

/**
 * Codex / Responses API may emit many alternating reasoning + message items.
 */
function pickAssistantMessageForChatCompletion(output: unknown[]): { msgItem: JsonObject | null; textContent: string | null } {
  if (!Array.isArray(output)) return { msgItem: null, textContent: null };
  const messages = output.filter((item) => (item as Record<string, unknown>)?.type === "message");
  if (messages.length === 0) return { msgItem: null, textContent: null };
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = textFromResponsesMessageItem(messages[i]);
    if (text.length > 0) return { msgItem: messages[i] as JsonObject, textContent: text };
  }
  const last = messages[messages.length - 1] as JsonObject;
  return { msgItem: last, textContent: textFromResponsesMessageItem(last) };
}

/**
 * Convert an OpenAI Chat Completions JSON body into the Responses API shape.
 */
function extractCustomToolInput(argumentsValue: unknown): string {
  const argumentsText = typeof argumentsValue === "string" ? argumentsValue : JSON.stringify(argumentsValue || {});
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && typeof parsed.input === "string") return parsed.input;
  } catch { /* raw freeform input */ }
  return argumentsText;
}

/**
 * The Responses translator emits `_customToolNames` as an array of names, so
 * that is the shape this takes. It used to be declared as a Set and call
 * `.has()`, which threw on the array it actually received.
 */
function chatCompletionToResponses(responseBody: JsonObject, customToolNames: string[] | null = null): JsonObject {
  const choice = (responseBody.choices as JsonObject[])?.[0];
  if (!choice) return responseBody;

  const message = (choice.message as JsonObject) || {};
  const output: JsonObject[] = [];

  const reasoning = (message.reasoning_content as string) || (message.reasoning as string);
  if (typeof reasoning === "string" && reasoning.length > 0) {
    output.push({
      type: RESPONSES_ITEM.REASONING,
      summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: reasoning }],
    });
  }

  const text = typeof message.content === "string" ? message.content : "";
  if (text.length > 0) {
    output.push({
      type: RESPONSES_ITEM.MESSAGE,
      role: ROLE.ASSISTANT,
      content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text, annotations: [] }],
    });
  }

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
  return {
    id: `resp_${responseBody.id || ""}`.replace(/^resp_chatcmpl-/, "resp_"),
    object: "response",
    created_at: responseBody.created || Math.floor(Date.now() / 1000),
    model: responseBody.model || "unknown",
    status: "completed",
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
 * Parse OpenAI-style SSE text into a single chat completion JSON.
 */
export function parseSSEToOpenAIResponse(rawSSE: string, fallbackModel: string): JsonObject | null {
  const chunks: JsonObject[] = [];
  let streamError: unknown = null;

  for (const line of String(rawSSE || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload) as JsonObject;
      if (chunk?.error) streamError = chunk.error;
      else chunks.push(chunk);
    } catch { /* ignore malformed lines */ }
  }

  if (streamError) return { error: streamError };
  if (chunks.length === 0) return null;

  const first = chunks[0];
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolCallMap = new Map<number, JsonObject>();
  let finishReason = "stop";
  let usage: JsonObject | null = null;

  for (const chunk of chunks) {
    const choice = chunk?.choices as JsonObject[] | undefined;
    const delta = (choice?.[0]?.delta as JsonObject) || {};
    if (typeof delta.content === "string" && delta.content.length > 0) contentParts.push(delta.content);
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) reasoningParts.push(delta.reasoning_content);
    if (choice?.[0]?.finish_reason) finishReason = choice[0].finish_reason as string;
    if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage as JsonObject;

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls as JsonObject[]) {
        const idx = (tc.index as number) ?? 0;
        if (!toolCallMap.has(idx)) {
          toolCallMap.set(idx, { id: tc.id || "", type: "function", function: { name: "", arguments: "" } });
        }
        const existing = toolCallMap.get(idx)!;
        if (tc.id) existing.id = tc.id;
        if ((tc.function as JsonObject)?.name) (existing.function as JsonObject).name = ((existing.function as JsonObject).name as string) + ((tc.function as JsonObject).name as string);
        if ((tc.function as JsonObject)?.arguments) (existing.function as JsonObject).arguments = ((existing.function as JsonObject).arguments as string) + ((tc.function as JsonObject).arguments as string);
      }
    }
  }

  const message: JsonObject = { role: "assistant", content: contentParts.join("") || (toolCallMap.size > 0 ? null : "") };
  if (reasoningParts.length > 0) message.reasoning_content = reasoningParts.join("");
  if (toolCallMap.size > 0) {
    message.tool_calls = [...toolCallMap.entries()].sort((a, b) => a[0] - b[0]).map(([, tc]) => tc);
  }

  const result: JsonObject = {
    id: first.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: first.created || Math.floor(Date.now() / 1000),
    model: first.model || fallbackModel || "unknown",
    choices: [{ index: 0, message, finish_reason: finishReason }]
  };
  if (usage) result.usage = usage;
  return result;
}

/**
 * Handle case: provider forced streaming but client wants JSON.
 */
// Exposed for tests: the custom-tool shape here regressed once already.
export const __test__ = { chatCompletionToResponses };

export async function handleForcedSSEToJson({ providerResponse, sourceFormat, targetFormat, provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, customToolNames, trackDone, appendLog, reqTag, log }: ForcedSSEToJsonContext) {
  const contentType = providerResponse.headers.get("content-type") || "";
  const isSSE = contentType.includes("text/event-stream") || (contentType === "" && isResponsesProvider(provider));
  if (!isSSE) return null;

  trackDone();

  const ctx = {
    provider, model, connectionId,
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null
  };

  const isCodexResponsesApi = isResponsesProvider(provider) || targetFormat === FORMATS.OPENAI_RESPONSES;
  if (isCodexResponsesApi) {
    try {
      const jsonResponse = await convertResponsesStreamToJson(providerResponse.body) as JsonObject;
      if (onRequestSuccess) await onRequestSuccess();

      const usage = (jsonResponse.usage as JsonObject) || {};
      appendLog({ tokens: usage, status: "200 OK" });
      saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, silent: true });
      if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime } }));

      const inTokensForLog = ((usage.input_tokens as number) || 0)
        + ((usage.cache_read_input_tokens as number) || (usage.cached_tokens as number) || 0)
        + ((usage.cache_creation_input_tokens as number) || 0);
      const { textContent } = pickAssistantMessageForChatCompletion(jsonResponse.output as unknown[]);
      const totalLatency = Date.now() - requestStartTime;

      saveRequestDetail(buildRequestDetail({
        ...ctx,
        latency: { ttft: totalLatency, total: totalLatency },
        tokens: { prompt_tokens: inTokensForLog, completion_tokens: (usage.output_tokens as number) || 0 },
        response: { content: textContent, thinking: null, finish_reason: (jsonResponse.status as string) || "unknown" },
        status: "success"
      }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

      if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
        return { success: true, response: new Response(JSON.stringify(jsonResponse), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
      }

      const cacheRead = (usage.cache_read_input_tokens as number) || (usage.cached_tokens as number) || 0;
      const cacheCreate = (usage.cache_creation_input_tokens as number) || 0;
      const inTokens = ((usage.input_tokens as number) || 0) + cacheRead + cacheCreate;
      const outTokens = (usage.output_tokens as number) || 0;
      const cacheDetails = (cacheRead > 0 || cacheCreate > 0)
        ? { prompt_tokens_details: {
              ...(cacheRead > 0 ? { cached_tokens: cacheRead } : {}),
              ...(cacheCreate > 0 ? { cache_creation_tokens: cacheCreate } : {}) } }
        : {};
      let finalResp: JsonObject;

      const funcCallItems = ((jsonResponse.output as JsonObject[]) || []).filter((item) => item.type === "function_call");
      const toolCalls = funcCallItems.map((item, idx) => ({
        id: (item.call_id as string) || `call_${item.name}_${Date.now()}_${idx}`,
        type: "function",
        function: {
          name: item.name,
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {})
        }
      }));
      const hasToolCalls = toolCalls.length > 0;

      if (sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI) {
        finalResp = {
          response: {
            candidates: [{ content: { role: "model", parts: [{ text: textContent || "" }] }, finishReason: "STOP", index: 0 }],
            usageMetadata: { promptTokenCount: inTokens, candidatesTokenCount: outTokens, totalTokenCount: inTokens + outTokens },
            modelVersion: model,
            responseId: jsonResponse.id || `resp_${Date.now()}`
          }
        };
      } else {
        const message: JsonObject = { role: "assistant", content: textContent || (hasToolCalls ? null : "") };
        if (hasToolCalls) message.tool_calls = toolCalls;
        const responseDone = jsonResponse.status === "completed" || jsonResponse.status === "done";
        const finishReason = hasToolCalls ? "tool_calls" : (responseDone ? "stop" : (jsonResponse.status || "stop"));
        finalResp = {
          id: jsonResponse.id || `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: jsonResponse.created_at || Math.floor(Date.now() / 1000),
          model: jsonResponse.model || model,
          choices: [{ index: 0, message, finish_reason: finishReason }],
          usage: { prompt_tokens: inTokens, completion_tokens: outTokens, total_tokens: inTokens + outTokens, ...cacheDetails }
        };
      }

      return { success: true, response: new Response(JSON.stringify(finalResp), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
    } catch (err: unknown) {
      console.error("[ChatCore] Responses API SSE→JSON failed:", err);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
    }
  }

  // Standard Chat Completions SSE path
  try {
    const sseText = await providerResponse.text();
    const parsed = parseSSEToOpenAIResponse(sseText, model);
    if (!parsed) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");
    if (parsed.error) {
      return createErrorResult(
        HTTP_STATUS.BAD_GATEWAY,
        ((parsed.error as JsonObject)?.message as string) || "Upstream SSE stream failed"
      );
    }

    if (onRequestSuccess) await onRequestSuccess();

    const usage = (parsed.usage as JsonObject) || {};
    appendLog({ tokens: usage, status: "200 OK" });
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, silent: true });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime } }));

    const totalLatency = Date.now() - requestStartTime;
    saveRequestDetail(buildRequestDetail({
      ...ctx,
      latency: { ttft: totalLatency, total: totalLatency },
      tokens: usage,
      response: {
        content: ((parsed.choices as JsonObject[])?.[0]?.message as JsonObject)?.content || null,
        thinking: ((parsed.choices as JsonObject[])?.[0]?.message as JsonObject)?.reasoning_content || null,
        finish_reason: ((parsed.choices as JsonObject[])?.[0]?.finish_reason as string) || "unknown"
      },
      status: "success"
    }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

    if (usage && Object.keys(usage).length > 0) parsed.usage = usage;

    if (parsed?.choices) {
      for (const choice of parsed.choices as JsonObject[]) {
        const msg = choice?.message as JsonObject;
        if (msg?.reasoning_content && msg.content) {
          delete msg.reasoning_content;
        }
      }
    }

    const finalBody = sourceFormat === FORMATS.OPENAI_RESPONSES
      ? chatCompletionToResponses(parsed, customToolNames)
      : parsed;

    return { success: true, response: new Response(JSON.stringify(finalBody), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
  } catch (err: unknown) {
    console.error("[ChatCore] Chat Completions SSE→JSON failed:", err);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
  }
}
