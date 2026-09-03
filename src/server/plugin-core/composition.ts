// Layered plugin composition, kept free of Cordis and of the database so the
// whole of the layering, validation and failure behaviour is testable on its
// own. See docs/superpowers/specs/2026-09-02-db-plugin-system-design.md.
//
// A bundle declares its default rows in code. A stored patch row with the same
// id replaces that row; a patch row with a new id inserts one. An empty patch
// therefore reproduces the bundle exactly, which is what lets the feature ship
// inert and keeps a malformed row from ever preventing boot.

/** A default row declared in code by a bundle. */
export interface BundleRow {
  id: string;
  plugin: string;
  config: Record<string, unknown>;
}

/** A stored row that overrides a bundle row by id, or inserts a new one. */
export interface PatchRow {
  id: string;
  plugin: string;
  config: Record<string, unknown>;
  position: number;
  enabled: boolean;
  source: "override" | "user";
}

export interface ResolvedRow {
  id: string;
  plugin: string;
  config: Record<string, unknown>;
  position: number;
  origin: "bundle" | "override" | "user";
}

/** Why a stored row was ignored — surfaced to the UI, never thrown. */
export interface CompositionDiagnostic {
  rowId: string;
  reason: string;
}

export interface CompositionResult {
  rows: ResolvedRow[];
  diagnostics: CompositionDiagnostic[];
}

/** The set of plugin factories a row may mount, and their config validation. */
export interface FactoryRegistry {
  has(plugin: string): boolean;
  /** Returns an error message, or null when the config is acceptable. */
  validate(plugin: string, config: Record<string, unknown>): string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rejects a row that is not shaped like a row at all, before anything reads it. */
function shapeError(row: PatchRow): string | null {
  if (typeof row?.id !== "string" || !row.id) return "row has no id";
  if (typeof row.plugin !== "string" || !row.plugin) return "row has no plugin";
  if (!isPlainObject(row.config)) return "row config is not an object";
  return null;
}

/** Runs the registry's validator without letting a throwing validator escape. */
function validationError(
  registry: FactoryRegistry,
  plugin: string,
  config: Record<string, unknown>,
): string | null {
  try {
    return registry.validate(plugin, config);
  } catch (error) {
    return error instanceof Error ? error.message : "config validation failed";
  }
}

/**
 * Resolves bundle defaults against a stored patch layer.
 *
 * A rejected patch row degrades to the bundle default rather than removing the
 * plugin, so a bad stored row can only ever cost the customisation, never the
 * capability.
 */
export function composePluginRows(
  bundleRows: readonly BundleRow[],
  patchRows: readonly PatchRow[],
  registry: FactoryRegistry,
): CompositionResult {
  const diagnostics: CompositionDiagnostic[] = [];
  const resolved = new Map<string, ResolvedRow>();

  bundleRows.forEach((row, index) => {
    resolved.set(row.id, {
      id: row.id,
      plugin: row.plugin,
      config: row.config,
      position: index,
      origin: "bundle",
    });
  });

  for (const row of patchRows) {
    const malformed = shapeError(row);
    if (malformed) {
      diagnostics.push({ rowId: typeof row?.id === "string" ? row.id : "", reason: malformed });
      continue;
    }
    if (!registry.has(row.plugin)) {
      diagnostics.push({ rowId: row.id, reason: `unknown plugin factory: ${row.plugin}` });
      continue;
    }
    const invalid = validationError(registry, row.plugin, row.config);
    if (invalid) {
      diagnostics.push({ rowId: row.id, reason: invalid });
      continue;
    }

    const position = Number.isFinite(row.position) ? row.position : 0;
    const enabled = row.enabled !== false;

    if (resolved.has(row.id)) {
      if (!enabled) resolved.delete(row.id);
      else resolved.set(row.id, { id: row.id, plugin: row.plugin, config: row.config, position, origin: "override" });
      continue;
    }
    if (row.source === "user") {
      if (enabled) {
        resolved.set(row.id, { id: row.id, plugin: row.plugin, config: row.config, position, origin: "user" });
      }
      continue;
    }
    diagnostics.push({ rowId: row.id, reason: "override targets no bundle row" });
  }

  const rows = [...resolved.values()].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
  return { rows, diagnostics };
}
