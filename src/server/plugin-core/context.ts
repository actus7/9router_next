import { Context } from "cordis";
import { BUNDLE_CATALOG, setActiveHarnessCatalog } from "@/shared/harness/agentPlugins";
import type { PatchRow } from "./composition";
import { executorsPlugin } from "./plugins/executors-plugin";
import { providersPlugin } from "./plugins/providers-plugin";
import { BUNDLE_ROWS, catalogFromRows } from "./bundleRows";
import { composePluginRows, type CompositionDiagnostic, type ResolvedRow } from "./composition";
import { factoryRegistry, mountExecutorRows, PROVIDER_EXECUTOR } from "./factories";
import { unregisterExecutor } from "./pluginRegistry";

let rootContext: Context | null = null;
let booting: Promise<Context> | null = null;

export interface PluginTreeState {
  /** The patch-layer revision this tree was composed from. */
  revision: number;
  rows: ResolvedRow[];
  /** Stored rows that were ignored, and why. */
  diagnostics: CompositionDiagnostic[];
}

let treeState: PluginTreeState = { revision: 0, rows: [], diagnostics: [] };

export function getPluginTreeState(): PluginTreeState {
  return treeState;
}

/** Providers mounted by the current tree, so a reload can retire the ones a new composition dropped. */
let mountedProviders: string[] = [];

/**
 * Reads the stored patch layer. The database is not a hard dependency of boot:
 * if it cannot be reached the bundle defaults still compose, which is the whole
 * point of layering a patch over a static base.
 */
async function readPatchLayer(): Promise<{ rows: PatchRow[]; revision: number }> {
  try {
    const repo = await import("@/lib/db/repos/pluginRowsRepo");
    const [rows, revision] = await Promise.all([
      repo.listPluginRows(),
      repo.getPluginTreeRevision(),
    ]);
    return { rows, revision };
  } catch {
    return { rows: [], revision: 0 };
  }
}

/**
 * Composes the bundle rows against the stored patch layer, mounts the executor
 * rows into the Cordis tree, and publishes the capability rows as the active
 * catalogue the chat resolves against.
 */
export async function reloadPluginTree(ctx: Context): Promise<PluginTreeState> {
  const { rows: patchRows, revision } = await readPatchLayer();
  const { rows, diagnostics } = composePluginRows(BUNDLE_ROWS, patchRows, factoryRegistry);

  const nextProviders = rows
    .filter((row) => row.plugin === PROVIDER_EXECUTOR)
    .map((row) => String(row.config.provider));
  for (const provider of mountedProviders) {
    if (!nextProviders.includes(provider)) unregisterExecutor(provider);
  }
  const mountDiagnostics = mountExecutorRows(ctx, rows);
  mountedProviders = nextProviders;

  setActiveHarnessCatalog(catalogFromRows(rows));
  treeState = { revision, rows, diagnostics: [...diagnostics, ...mountDiagnostics] };
  return treeState;
}

export function bootstrap(): Promise<Context> {
  booting ??= (async () => {
    const ctx = new Context();
    // executorsPlugin/providersPlugin are the base services every composed row
    // depends on (ctx.executors, ctx.providers) — they load first.
    await ctx.plugin(executorsPlugin);
    await ctx.plugin(providersPlugin);
    await reloadPluginTree(ctx);
    rootContext = ctx;
    return ctx;
  })().catch((err) => {
    booting = null; // don't cache a poisoned boot attempt
    throw err;
  });
  return booting;
}

export function getContext(): Context {
  if (!rootContext) {
    throw new Error("plugin-core: call bootstrap() before getContext()");
  }
  return rootContext;
}

export async function resetContext(): Promise<void> {
  if (rootContext) {
    await rootContext.fiber.dispose();
    rootContext = null;
  }
  booting = null;
  mountedProviders = [];
  treeState = { revision: 0, rows: [], diagnostics: [] };
  setActiveHarnessCatalog(BUNDLE_CATALOG);
}

export type { Context };
