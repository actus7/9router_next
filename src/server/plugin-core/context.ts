import { Context } from "cordis";
import { BUNDLE_CATALOG, setActiveHarnessCatalog } from "@/shared/harness/agentPlugins";
import { currentTenantId } from "@/lib/db/tenant";
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

/**
 * Composed plugin trees, keyed by account.
 *
 * It used to be one module-level `let`. `listPluginRows()` filters by tenant,
 * so the query was never the problem — the destination was: whoever wrote last
 * published their tree to the whole process, and `GET /api/harness/plugins`
 * handed it to the next account that asked, catalogue included. The client then
 * adopted it (`usePluginComposition`), so one account's toggles decided which
 * tools another account's model was offered.
 *
 * Same fix, same reason, as `src/server/harness/skills/context.ts`.
 */
const treeStates: Map<string, PluginTreeState> = new Map();

/**
 * The account to key on, or null outside a request.
 *
 * `bootstrap()` runs from `instrumentation.ts` with no tenant established, and
 * that composition is the bundle defaults — correct for everyone, owned by
 * no one, so it is not cached against an account.
 */
function tenantKeyOrNull(): string | null {
  try {
    return currentTenantId();
  } catch {
    return null;
  }
}

/** Bundle defaults with no stored layer — what an account with no rows gets. */
function bundleOnlyState(): PluginTreeState {
  const { rows, diagnostics } = composePluginRows(BUNDLE_ROWS, [], factoryRegistry);
  return { revision: 0, rows, diagnostics };
}

export function getPluginTreeState(): PluginTreeState {
  const tenantId = tenantKeyOrNull();
  const cached = tenantId === null ? undefined : treeStates.get(tenantId);
  const state = cached ?? bundleOnlyState();
  if (tenantId !== null && !cached) treeStates.set(tenantId, state);
  setActiveHarnessCatalog(catalogFromRows(state.rows));
  return state;
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
  const state: PluginTreeState = { revision, rows, diagnostics: [...diagnostics, ...mountDiagnostics] };
  const tenantId = tenantKeyOrNull();
  if (tenantId !== null) treeStates.set(tenantId, state);
  return state;
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
  treeStates.clear();
  setActiveHarnessCatalog(BUNDLE_CATALOG);
}

export type { Context };
