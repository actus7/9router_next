import "server-only";

import variant from "@jitl/quickjs-singlefile-cjs-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
} from "quickjs-emscripten-core";

export interface SandboxEvalRequest {
  source: string;
  toolName?: string;
  input: Record<string, unknown>;
  timeoutMs?: number;
}

export interface SandboxEvalResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 500;

// Capability source is authored in the dashboard, so anything larger than this
// is a malformed or hostile payload rather than a plugin, and it would be paid
// for in QuickJS compile time before any interrupt handler could stop it.
const MAX_SOURCE_CHARS = 64 * 1024;

let quickJsModulePromise: ReturnType<typeof newQuickJSWASMModuleFromVariant> | null =
  null;

async function getQuickJsModule() {
  if (!quickJsModulePromise) {
    quickJsModulePromise = newQuickJSWASMModuleFromVariant(variant);
  }
  return quickJsModulePromise;
}

/** QuickJS dumps a thrown Error to a plain object; String() on it loses the message. */
function describeError(dumped: unknown): string {
  if (typeof dumped === "string") return dumped;
  if (dumped && typeof dumped === "object") {
    const message = (dumped as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(dumped);
}

/**
 * Reads the value a tool returned, settling it first when it is a promise.
 *
 * The sync runtime exposes no host I/O, so a promise can only be waiting on a
 * job already queued inside the VM: drain those, then read the settled state.
 * Anything still pending is a tool that cannot finish in this sandbox — a
 * failure, rather than the empty object `dump` would otherwise hand back.
 */
function unwrapToolResult(
  runtime: QuickJSRuntime,
  context: QuickJSContext,
  value: QuickJSHandle,
): SandboxEvalResult {
  runtime.executePendingJobs();
  // A non-promise comes back as fulfilled with the original handle and
  // notAPromise: true, so this covers both shapes without sniffing for `then`.
  const state = context.getPromiseState(value);

  if (state.type === "pending") {
    return { ok: false, error: "Sandbox tool returned a promise that never settled" };
  }
  if (state.type === "rejected") {
    const error = describeError(context.dump(state.error));
    state.error.dispose();
    return { ok: false, error };
  }
  const result = context.dump(state.value);
  if (!state.notAPromise) state.value.dispose();
  return { ok: true, result };
}

export async function runSandboxCapability(
  request: SandboxEvalRequest,
): Promise<SandboxEvalResult> {
  const source = request.source.trim();
  if (!source) return { ok: false, error: "source is required" };
  if (source.length > MAX_SOURCE_CHARS) {
    return { ok: false, error: `source exceeds ${MAX_SOURCE_CHARS} characters` };
  }

  const QuickJS = await getQuickJsModule();
  const runtime: QuickJSRuntime = QuickJS.newRuntime();
  runtime.setMemoryLimit(8 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const context: QuickJSContext = runtime.newContext();
  const timeoutMs = Math.max(50, Math.min(5_000, request.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const deadline = Date.now() + timeoutMs;
  runtime.setInterruptHandler(() => Date.now() > deadline);

  try {
    const inputJson = JSON.stringify(request.input ?? {});
    const toolNameJson = JSON.stringify(request.toolName?.trim() || "");
    const wrapped = [
      "(() => {",
      "const __input = " + inputJson + ";",
      "const __tools = {};",
      "function registerTool(name, fn) {",
      '  if (typeof name !== "string" || typeof fn !== "function") {',
      '    throw new Error("registerTool(name, fn) requires a string and function");',
      "  }",
      "  __tools[name] = fn;",
      "}",
      source,
      "const __toolName = " + toolNameJson + ' || Object.keys(__tools)[0];',
      'if (!__toolName || typeof __tools[__toolName] !== "function") {',
      '  throw new Error("No sandbox tool registered");',
      "}",
      "return __tools[__toolName](__input);",
      "})()",
    ].join("\n");
    const evalResult = context.evalCode(wrapped);
    if (evalResult.error) {
      const message = describeError(context.dump(evalResult.error));
      evalResult.error.dispose();
      return { ok: false, error: message };
    }
    try {
      return unwrapToolResult(runtime, context, evalResult.value);
    } finally {
      evalResult.value.dispose();
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Sandbox execution failed",
    };
  } finally {
    context.dispose();
    runtime.dispose();
  }
}
