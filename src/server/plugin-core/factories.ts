import type { Context } from "cordis";
import { OpenCodeExecutor } from "@/server/llm-gateway/engine/executors/opencode";
import { HARNESS_PLUGINS } from "@/shared/harness/agentPlugins";
import type { CompositionDiagnostic, FactoryRegistry, ResolvedRow } from "./composition";

// The plugin factories a composed row may mount.
//
// `harness-capability` rows are pure data: they project into the catalogue the
// chat resolves against, and that projection has to reach the browser, so a
// capability can never hold a live reference. `provider-executor` rows own a
// real service lifecycle and mount into the Cordis tree. One composition
// pipeline feeds both, which is the unification that matters; forcing data rows
// through a service registry would add ceremony and break the Phase 2 sandbox
// boundary, which is serializable by construction.

export const HARNESS_CAPABILITY = "harness-capability";
export const PROVIDER_EXECUTOR = "provider-executor";

/** Executors a stored row is allowed to mount, by provider id. */
const MOUNTABLE_EXECUTORS: Record<string, () => unknown> = {
  opencode: () => new OpenCodeExecutor(),
};

const CAPABILITY_KINDS = new Set(["context", "mode", "tool"]);

// A capability may only advertise a tool the runtime can actually execute, and
// the implementations ship with the bundle. Without this a stored row could
// offer the model a tool that always answers "unsupported runtime tool".
// Introducing a genuinely new tool is what the sandboxed factory is for.
const EXECUTABLE_TOOL_NAMES = new Set(
  HARNESS_PLUGINS.flatMap((plugin) => (plugin.tool ? [plugin.tool.function.name] : [])),
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function validateCapability(config: Record<string, unknown>): string | null {
  for (const field of ["id", "title", "description", "module"]) {
    if (!nonEmptyString(config[field])) return `capability config needs a ${field}`;
  }
  if (!CAPABILITY_KINDS.has(String(config.kind))) {
    return `capability kind must be one of ${[...CAPABILITY_KINDS].join(", ")}`;
  }
  if (config.tool !== undefined) {
    const tool = config.tool;
    if (!isPlainObject(tool)) return "capability tool must be an object";
    const fn = tool.function;
    if (!isPlainObject(fn) || !nonEmptyString(fn.name)) {
      return "capability tool needs function.name";
    }
    if (!EXECUTABLE_TOOL_NAMES.has(String(fn.name))) {
      return `no runtime implementation for tool: ${String(fn.name)}`;
    }
  }
  return null;
}

function validateExecutor(config: Record<string, unknown>): string | null {
  const provider = config.provider;
  if (!nonEmptyString(provider)) return "executor config needs a provider";
  if (!(String(provider) in MOUNTABLE_EXECUTORS)) {
    return `no mountable executor for provider: ${String(provider)}`;
  }
  return null;
}

export const factoryRegistry: FactoryRegistry = {
  has: (plugin) => plugin === HARNESS_CAPABILITY || plugin === PROVIDER_EXECUTOR,
  validate: (plugin, config) =>
    plugin === HARNESS_CAPABILITY
      ? validateCapability(config)
      : plugin === PROVIDER_EXECUTOR
        ? validateExecutor(config)
        : `unknown plugin factory: ${plugin}`,
};

/**
 * Mounts the executor rows into the Cordis tree. Composition already validated
 * every row, so a failure here is a genuine construction fault: it is reported
 * and skipped rather than allowed to abort boot.
 */
export function mountExecutorRows(
  ctx: Context,
  rows: readonly ResolvedRow[],
): CompositionDiagnostic[] {
  const diagnostics: CompositionDiagnostic[] = [];
  for (const row of rows) {
    if (row.plugin !== PROVIDER_EXECUTOR) continue;
    const provider = String(row.config.provider);
    try {
      ctx.executors.register(provider, MOUNTABLE_EXECUTORS[provider]!());
    } catch (error) {
      diagnostics.push({
        rowId: row.id,
        reason: error instanceof Error ? error.message : "executor failed to mount",
      });
    }
  }
  return diagnostics;
}
