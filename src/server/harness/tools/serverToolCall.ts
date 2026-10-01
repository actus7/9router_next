import "server-only";

import { handleChat } from "@/server/llm-gateway/chat";
import { handleFetch } from "@/server/llm-gateway/application/fetch";
import { handleSearch } from "@/server/llm-gateway/application/search";
import { buildModelsList } from "@/server/application/use-cases/http/v1/models/route";
import { callSessionMcpTool } from "@/server/harness/mcpClient";
import { decideWithJev } from "@/server/decisions/jev";
import {
  generateImageServerSide,
  generateVideoServerSide,
  textToSpeechServerSide,
} from "./serverMediaTools";
import {
  SERVER_HARNESS_TOOLS,
  executeHarnessToolServerSide,
} from "./serverHarnessTools";
import { guardUntrustedContent } from "./contentGuardrail";

/**
 * Runs a tool call inside the durable worker, with no browser involved.
 *
 * The browser's executor reaches every one of these through an HTTP route on
 * this same server, so the work already lives here — what lived only in the
 * browser was the *loop*. Dispatching in-process instead of over HTTP is also
 * what makes it possible at all: the harness routes authenticate with the
 * dashboard session, which a worker does not have, while in-process calls run
 * inside the `withTenant(owner)` the run was started with.
 *
 * Returns `null` for a tool this side cannot run, which is how the loop knows
 * to leave those calls on the settled row for a browser to pick up. Nothing is
 * silently skipped and nothing runs twice.
 */

/**
 * Tool names this side executes.
 *
 * Everything, now, except the models that are themselves the browser: Puter
 * runs the completion inside `js.puter.com`, so a run on it never reaches a
 * worker in the first place (`executeSendMessage` branches before the durable
 * path). There is nothing left here that the browser does better.
 */
export const SERVER_EXECUTABLE_TOOLS: ReadonlySet<string> = new Set([
  "web_search",
  "web_fetch",
  "delegate_task",
  "generate_image",
  "text_to_speech",
  "generate_video",
  ...SERVER_HARNESS_TOOLS,
]);

export interface ServerToolContext {
  sessionId: string;
  /** Forwarded to the gateway exactly as the run's own request does. */
  authorization: string | null;
  /** Tool names the session has enabled, from the plugin composition. */
  enabledToolNames: ReadonlySet<string>;
  /** MCP tool names this session exposes, namespaced `mcp_<server>_<n>`. */
  mcpRuntimeNames: ReadonlySet<string>;
  /** Ceiling for `web_search`, from the session's plugin settings. */
  webSearchMaxResults?: number;
  /** Ceiling for `web_fetch`, from the session's plugin settings. */
  webFetchMaxCharacters?: number;
  /** The run's model, so `delegate_task` defaults to the same one. */
  model: string | null;
  /**
   * Epoch ms this run must be finished by.
   *
   * The worker has no `AbortSignal` — a stop reaches it as a progress write
   * that matches no row — so waits are bounded by the run's own budget against
   * `maxDuration` instead.
   */
  deadline: number;
  /** Skills the session enabled, so `load_skill` keeps its scope. */
  enabledSkillIds?: ReadonlySet<string>;
}

export interface ServerToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Same ceiling the browser applies, so a result cannot blow up the next turn. */
const MAX_RESULT_CHARS = 30_000;

function failure(error: string): string {
  return JSON.stringify({ ok: false, error });
}

function truncate(text: string): string {
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…` : text;
}

function parseArguments(raw: string): Record<string, unknown> | string {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "Tool arguments must be an object";
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid tool arguments";
  }
}

/** Calls a gateway handler in-process, the way the run's own chat call does. */
async function callGateway(
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: Record<string, unknown>,
  authorization: string | null,
): Promise<{ ok: boolean; payload: unknown; status: number }> {
  const response = await handler(
    new Request(`http://durable-run.local${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  const payload = await response.json().catch(() => null);
  return { ok: response.ok, payload, status: response.status };
}

/**
 * Providers for a web capability, in the order the browser would try them.
 *
 * Read straight from the catalogue rather than through `/api/v1/models/web`,
 * which is the same projection with an HTTP hop in front of it.
 */
async function webProviders(kind: "webSearch" | "webFetch"): Promise<string[]> {
  const entries = (await buildModelsList([kind]).catch(() => [])) as Array<{
    id?: unknown;
    owned_by?: unknown;
    kind?: unknown;
  }>;
  const providers: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== kind) continue;
    const provider =
      entry.owned_by !== "combo" && typeof entry.owned_by === "string" && entry.owned_by
        ? entry.owned_by
        : typeof entry.id === "string"
          ? entry.id.replace(/\/(search|fetch)$/, "")
          : null;
    if (provider && !providers.includes(provider)) providers.push(provider);
  }
  return providers;
}

/** Tries each provider until one answers, like the browser's fallback does. */
async function withProviderFallback(
  providers: readonly string[],
  label: string,
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: (provider: string) => Record<string, unknown>,
  authorization: string | null,
  guardSurface?: "web_fetch",
): Promise<string> {
  const attempts: string[] = [];
  for (const provider of providers) {
    const result = await callGateway(handler, path, body(provider), authorization).catch(() => null);
    if (result?.ok) {
      const serialized = JSON.stringify({ ok: true, provider, result: result.payload });
      // The page a fetch provider returns is untrusted: flagged content gets a
      // warning prefix before the truncation that closes the result.
      return truncate(guardSurface ? await guardUntrustedContent(serialized, guardSurface) : serialized);
    }
    attempts.push(`${provider}: ${result ? result.status : "unreachable"}`);
  }
  return failure(`No ${label} provider answered (${attempts.join(", ") || "none configured"})`);
}

// Delegated subtasks are the cheapest place to experiment with model choice:
// one shot, no tools, no conversation to corrupt. The shortlist is capped so
// the choice question stays small and the pick is never among hundreds.
const DELEGATE_CANDIDATES = 12;
const DELEGATE_MODEL_TIMEOUT_MS = 1_500;
const MIN_DELEGATE_CONFIDENCE = 0.6;

/** LLM model keys for `delegate_task`, the run's own model first. */
async function delegateModelCandidates(currentModel: string | null): Promise<string[]> {
  const entries = (await buildModelsList(["llm"]).catch(() => [])) as Array<{
    id?: unknown;
    kind?: unknown;
  }>;
  const keys: string[] = [];
  for (const entry of entries) {
    // The LLM list carries no `kind` on ordinary models; anything explicit and
    // not `llm` (a smart combo) is a routing mode, not a concrete model.
    if (entry.kind != null && entry.kind !== "llm") continue;
    if (typeof entry.id === "string" && entry.id && !keys.includes(entry.id)) keys.push(entry.id);
  }
  if (!currentModel) return keys.slice(0, DELEGATE_CANDIDATES);
  return [currentModel, ...keys.filter((key) => key !== currentModel)].slice(0, DELEGATE_CANDIDATES);
}

/**
 * Jev picks the delegate's model when the caller did not name one. A choice
 * inside the shortlist with enough confidence wins; anything else — no Jev,
 * a weak answer, a key outside the shortlist — keeps the run's own model.
 */
async function pickDelegateModel(task: string, currentModel: string | null): Promise<string | null> {
  const candidates = await delegateModelCandidates(currentModel);
  if (candidates.length === 0) return currentModel;
  const decision = await decideWithJev(
    "delegateModel",
    { task: task.slice(0, 800), candidates },
    {
      model: {
        type: "choice",
        instructions:
          "Which model should run this delegated subtask in one shot, with no tools? Prefer the cheapest model that reliably completes it.",
        criteria: Object.fromEntries(candidates.map((key) => [key, `Model ${key}`])),
      },
    },
    { timeoutMs: DELEGATE_MODEL_TIMEOUT_MS },
  );
  const answer = decision?.answers.model;
  return answer?.type === "choice" && candidates.includes(answer.choice) && answer.confidence >= MIN_DELEGATE_CONFIDENCE
    ? answer.choice
    : currentModel;
}

export async function executeServerToolCall(
  call: ServerToolCall,
  context: ServerToolContext,
): Promise<string | null> {
  const isMcp = context.mcpRuntimeNames.has(call.name);
  if (!isMcp && !SERVER_EXECUTABLE_TOOLS.has(call.name)) return null;
  if (!context.enabledToolNames.has(call.name)) {
    return failure(`Unsupported runtime tool or disabled in this session: ${call.name}`);
  }

  const args = parseArguments(call.arguments);
  if (typeof args === "string") return failure(args);

  if (isMcp) {
    try {
      const result = await callSessionMcpTool({
        sessionId: context.sessionId,
        runtimeName: call.name,
        args,
      });
      // MCP servers are third-party code answering with third-party content:
      // flagged results get a warning prefix before they reach the model.
      return truncate(await guardUntrustedContent(JSON.stringify({ ok: true, result }), "mcp_result"));
    } catch (error) {
      return failure(error instanceof Error ? error.message : "MCP tool call failed");
    }
  }

  const media = { authorization: context.authorization, deadline: context.deadline };
  if (call.name === "generate_image") return await generateImageServerSide(args, media);
  if (call.name === "text_to_speech") return await textToSpeechServerSide(args, media);
  if (call.name === "generate_video") return await generateVideoServerSide(args, media);

  const harness = await executeHarnessToolServerSide(call.name, args, {
    sessionId: context.sessionId,
    enabledSkillIds: context.enabledSkillIds,
  });
  if (harness !== null) return harness;

  if (call.name === "web_search") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return failure("web_search requires a query");
    const maxResults =
      typeof args.max_results === "number"
        ? Math.max(1, Math.min(10, Math.floor(args.max_results)))
        : context.webSearchMaxResults;
    return await withProviderFallback(
      await webProviders("webSearch"),
      "web search",
      handleSearch,
      "/api/v1/search",
      (provider) => ({ query, provider, ...(maxResults ? { max_results: maxResults } : {}) }),
      context.authorization,
    );
  }

  if (call.name === "web_fetch") {
    const url = typeof args.url === "string" ? args.url.trim() : "";
    if (!url) return failure("web_fetch requires a public URL");
    const maxCharacters =
      typeof args.max_characters === "number"
        ? Math.max(1, Math.min(MAX_RESULT_CHARS, Math.floor(args.max_characters)))
        : context.webFetchMaxCharacters;
    return await withProviderFallback(
      await webProviders("webFetch"),
      "web fetch",
      handleFetch,
      "/api/v1/web/fetch",
      (provider) => ({ provider, url, ...(maxCharacters ? { max_characters: maxCharacters } : {}) }),
      context.authorization,
      "web_fetch",
    );
  }

  // delegate_task: a single, non-streaming turn on the same model. It gets no
  // tools of its own, so it cannot recurse into another loop.
  const task = typeof args.task === "string" ? args.task.trim() : "";
  if (!task) return failure("delegate_task requires a task");
  // An explicit `model` always wins; only the default is worth a Jev call.
  const model =
    typeof args.model === "string" && args.model.trim()
      ? args.model.trim()
      : await pickDelegateModel(task, context.model);
  if (!model) return failure("delegate_task has no model to run on");
  const result = await callGateway(
    handleChat,
    "/api/v1/chat/completions",
    { model, messages: [{ role: "user", content: task }], stream: false },
    context.authorization,
  ).catch(() => null);
  if (!result?.ok) return failure(`Delegated task failed (${result ? result.status : "unreachable"})`);
  const choice = (result.payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)
    ?.choices?.[0]?.message?.content;
  return truncate(JSON.stringify({ ok: true, result: typeof choice === "string" ? choice : "" }));
}
