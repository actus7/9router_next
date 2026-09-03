import "server-only";

import variant from "@jitl/quickjs-singlefile-cjs-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
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
      const message = context.dump(evalResult.error);
      evalResult.error.dispose();
      return { ok: false, error: String(message) };
    }
    const dumped = context.dump(evalResult.value);
    evalResult.value.dispose();
    return { ok: true, result: dumped };
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
