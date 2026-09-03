import type { ToolCall } from "../types";
import { tryExecuteHarnessToolCall } from "./executeHarnessToolCall";
import {
  generateVideo,
  MAX_RESULT_CHARS,
  resolveMediaModels,
  resolveWebProviders,
  tryModelsForAudio,
  tryProvidersWithFallback,
  type RuntimeToolContext,
} from "./runtimeToolProviders";

export type { RuntimeToolContext };


export async function executeRuntimeToolCall(
  call: ToolCall,
  context: RuntimeToolContext,
): Promise<string> {
  const { apiKey, model, signal } = context;
  const supportedTools =
    context.enabledToolNames ??
    new Set([
      "web_search",
      "web_fetch",
      "delegate_task",
      "generate_image",
      "text_to_speech",
      "generate_video",
    ]);
  if (!supportedTools.has(call.name)) {
    return JSON.stringify({
      ok: false,
      error: `Unsupported runtime tool or disabled in this session: ${call.name}`,
    });
  }

  let arguments_: {
    query?: unknown;
    max_results?: unknown;
    task?: unknown;
    url?: unknown;
    max_characters?: unknown;
    prompt?: unknown;
    input?: unknown;
    voice?: unknown;
    model?: unknown;
    name?: unknown;
    description?: unknown;
    body?: unknown;
    enabled?: unknown;
    scope?: unknown;
    id?: unknown;
    content?: unknown;
    exclude_session_id?: unknown;
    path?: unknown;
    patch?: unknown;
    mode?: unknown;
    lesson?: unknown;
    plugin_id?: unknown;
    tool_name?: unknown;
    title?: unknown;
  };
  try {
    const parsed = JSON.parse(call.arguments);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Tool arguments must be an object");
    arguments_ = parsed;
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Invalid tool arguments",
    });
  }

  const mcpServer = context.mcpServers?.find(
    (server) =>
      server.enabled &&
      server.tools.some((tool) => tool.runtimeName === call.name),
  );
  if (mcpServer) {
    const response = await fetch("/api/harness/mcp/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: context.sessionId,
        serverId: mcpServer.id,
        runtimeName: call.name,
        arguments: arguments_,
      }),
      signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: unknown;
      error?: unknown;
    } | null;
    return JSON.stringify(
      payload?.ok
        ? { ok: true, result: payload.result }
        : {
            ok: false,
            error:
              typeof payload?.error === "string"
                ? payload.error
                : "Falha ao executar ferramenta MCP",
          },
    );
  }

  const harnessResult = await tryExecuteHarnessToolCall(
    call,
    context,
    arguments_,
    signal,
  );
  if (harnessResult !== null) return harnessResult;

  const requestedModel =
    typeof arguments_.model === "string" && arguments_.model.trim()
      ? arguments_.model.trim()
      : null;

  if (call.name === "generate_image") {
    if (typeof arguments_.prompt !== "string" || !arguments_.prompt.trim()) {
      return JSON.stringify({
        ok: false,
        error: "generate_image requires a non-empty prompt",
      });
    }
    const models = requestedModel
      ? [requestedModel]
      : await resolveMediaModels("image", apiKey, signal);
    if (models.length === 0)
      return JSON.stringify({
        ok: false,
        error: "No configured image generation provider is available",
      });

    return tryProvidersWithFallback(
      models,
      "image generation",
      (m) => ({
        url: "/api/v1/images/generations",
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ model: m, prompt: arguments_.prompt }),
        },
      }),
      signal,
    );
  }

  if (call.name === "text_to_speech") {
    if (typeof arguments_.input !== "string" || !arguments_.input.trim()) {
      return JSON.stringify({
        ok: false,
        error: "text_to_speech requires non-empty input",
      });
    }
    const models = requestedModel
      ? [requestedModel]
      : await resolveMediaModels("tts", apiKey, signal);
    if (models.length === 0)
      return JSON.stringify({
        ok: false,
        error: "No configured text-to-speech provider is available",
      });

    return tryModelsForAudio(
      models,
      (m) => ({
        url: "/api/v1/audio/speech",
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: m,
            input: arguments_.input,
            ...(typeof arguments_.voice === "string" && arguments_.voice.trim()
              ? { voice: arguments_.voice.trim() }
              : context.webFetchMaxCharacters
                ? { max_characters: context.webFetchMaxCharacters }
                : {}),
          }),
        },
      }),
      signal,
    );
  }

  if (call.name === "generate_video") {
    if (typeof arguments_.prompt !== "string" || !arguments_.prompt.trim()) {
      return JSON.stringify({
        ok: false,
        error: "generate_video requires a non-empty prompt",
      });
    }
    const models = requestedModel
      ? [requestedModel]
      : await resolveMediaModels("video", apiKey, signal);
    if (models.length === 0)
      return JSON.stringify({
        ok: false,
        error: "No configured video generation provider is available",
      });

    return generateVideo(models, arguments_.prompt, apiKey, signal);
  }

  if (call.name === "delegate_task") {
    if (typeof arguments_.task !== "string" || !arguments_.task.trim()) {
      return JSON.stringify({
        ok: false,
        error: "delegate_task requires a non-empty task",
      });
    }
    const response = await fetch("/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model.requestModel || model.id,
        stream: false,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are an ephemeral subagent. Complete only the delegated task. Be concise and return findings to the parent agent. Do not call tools, do not delegate, and do not claim actions you did not perform.",
          },
          { role: "user", content: arguments_.task.trim().slice(0, 12_000) },
        ],
      }),
      signal,
    });
    const text = await response.text();
    if (!response.ok)
      return JSON.stringify({
        ok: false,
        status: response.status,
        error: text.slice(0, MAX_RESULT_CHARS),
      });
    try {
      const payload = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      return JSON.stringify({
        ok: true,
        result:
          typeof content === "string"
            ? content
            : text.slice(0, MAX_RESULT_CHARS),
      });
    } catch {
      return JSON.stringify({
        ok: true,
        result: text.slice(0, MAX_RESULT_CHARS),
      });
    }
  }

  if (call.name === "web_fetch") {
    if (typeof arguments_.url !== "string" || !arguments_.url.trim()) {
      return JSON.stringify({
        ok: false,
        error: "web_fetch requires a public URL",
      });
    }
    const providers = await resolveWebProviders("webFetch", apiKey, signal);
    if (providers.length === 0)
      return JSON.stringify({
        ok: false,
        error: "No configured web fetch provider is available",
      });

    return tryProvidersWithFallback(
      providers,
      "web fetch",
      (provider) => ({
        url: "/api/v1/web/fetch",
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            provider,
            url: arguments_.url!.toString().trim(),
            ...(typeof arguments_.max_characters === "number"
              ? {
                  max_characters: Math.max(
                    500,
                    Math.min(
                      MAX_RESULT_CHARS,
                      Math.floor(arguments_.max_characters as number),
                    ),
                  ),
                }
              : {}),
          }),
        },
      }),
      signal,
    );
  }

  if (typeof arguments_.query !== "string" || !arguments_.query.trim()) {
    return JSON.stringify({
      ok: false,
      error: "web_search requires a non-empty query",
    });
  }

  const providers = await resolveWebProviders("webSearch", apiKey, signal);
  if (providers.length === 0)
    return JSON.stringify({
      ok: false,
      error: "No configured web search provider is available",
    });

  return tryProvidersWithFallback(
    providers,
    "web search",
    (provider) => ({
      url: "/api/v1/search",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          query: arguments_.query!.toString().trim(),
          provider,
          ...(typeof arguments_.max_results === "number"
            ? {
                max_results: Math.max(
                  1,
                  Math.min(10, Math.floor(arguments_.max_results as number)),
                ),
              }
            : context.webSearchMaxResults
              ? { max_results: context.webSearchMaxResults }
              : {}),
        }),
      },
    }),
    signal,
  );
}
