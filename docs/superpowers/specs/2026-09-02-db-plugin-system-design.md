# DB-backed plugin system — design

Status: approved design, Phase 1 scoped for implementation.

Reference: [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), an
all-plugin Cordis harness. We borrow its composition model and diverge where its
long-lived local process assumptions do not hold here. Sandbox feasibility was
settled first, in [docs/spikes/2026-09-02-sandboxed-plugin-execution.md](../../spikes/2026-09-02-sandboxed-plugin-execution.md).

## Problem

ModelHub has two unrelated plugin systems. `src/server/plugin-core` is a Cordis
tree that registers executors and providers at boot from a static array.
`src/shared/harness/agentPlugins.ts` is a second static catalogue of agent
capabilities with per-conversation toggles. Neither can change without a build,
and they do not know about each other.

## What we are building

One Cordis tree whose composition comes from the database, absorbing both
systems. Phase 2 adds plugins whose source code also lives in the database and
runs sandboxed; Phase 1 builds the registry, lifecycle and composition it needs.

## Constraints that shaped the design

- **The deploy target includes bundled serverless functions.** `bootstrap()` runs
  once per process from the Next instrumentation hook. Live per-conversation
  Cordis fibers cannot survive between requests, so per-session state must be
  persisted, not held in a fiber.
- **Single tenant.** No `userId` exists anywhere in `src/lib/db`. Plugin rows are
  install-wide.
- **The chat hot path is client-side.** `getRuntimeToolDefinitions` and
  `buildSessionSystemPrompt` are called from browser code, so the resolved
  catalogue has to reach the client, not just the server.
- **`cordis@^4.0.0-rc.8` is already a dependency** and `plugin-core` already uses it.

## Approach: a patch layer over a static base

The database table is a **patch table**, not the full plugin list.

A bundle in the repository declares its default rows in code. A database row with
the same `id` replaces that row's config, position, or enabled flag. A row with a
new `id` inserts an additional plugin. The decisive property is that **an empty
table reproduces today's behaviour exactly**, so the feature ships inert and a
malformed row can never prevent boot.

Layer order mirrors the reference: bundle rows in declared order, then the
database patch layer, then the per-session projection.

### Data model

The table is purely additive, and `schema.ts` is declarative with
`syncSchemaFromTables()` creating anything missing after the versioned
migrations. It is therefore declared there rather than in a migration file, and
the revision counter reuses the existing `_meta` key/value table instead of a
table of its own. Both simplifications came from the codebase, not the design.

    pluginRows(
      id TEXT PRIMARY KEY,   -- patch target; matches a bundle row id
      plugin TEXT NOT NULL,  -- the plugin factory this row mounts
      config TEXT NOT NULL,  -- JSON
      position INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL,  -- 'override' | 'user'
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
    _meta['pluginTreeRevision']  -- monotonic counter

The counter is bumped inside the same transaction as every write. Deriving it
from `MAX(updatedAt)` would miss two writes in the same millisecond with an
unchanged row count.

### Composition is a pure function

`composePluginRows(bundleRows, patchRows)` returns resolved rows plus
diagnostics. It lives apart from Cordis and the database, so the whole of the
layering, validation and failure behaviour is testable without either.

It never throws. A patch row naming an unknown factory, or carrying a config its
factory rejects, is dropped and reported in diagnostics so the UI can explain why
a row was ignored.

### Plugin factories

A row mounts a named factory with a config:

- `harness-capability` registers one agent capability (the current
  `HarnessPluginDefinition` shape: prompt section, mode, or tool).
- `provider-executor` registers a gateway executor, replacing the current static
  `corePlugins` array entry.

Phase 2 adds `sandboxed-capability`, whose config carries source code.

A capability row may only advertise a tool the runtime can already execute, and
those implementations ship with the bundle. Without that rule a stored row could
offer the model a tool that always answers "unsupported runtime tool".
Introducing a genuinely new tool is precisely what the sandboxed factory is for,
so the restriction lifts in Phase 2 rather than being worked around in Phase 1.

### Per-session scoping

Rejected: a Cordis child fiber per conversation. Under serverless it cannot
survive between requests, and nothing today needs live per-session effects.

Adopted: the composed catalogue is global, and a conversation projects a filtered
view of it from its preset plus overrides, which is how the code already works.
The existing resolution functions keep their signatures and read from an active
catalogue that defaults to the bundle rows:

    resolveSessionPluginsFrom(catalog, presetId, overrides)  // pure
    resolveSessionPlugins(presetId, overrides)               // bound to active
    setActiveHarnessCatalog(catalog)

Every existing call site keeps working unchanged. The server sets the active
catalogue after boot; the client fetches it and falls back to the bundle rows
until it arrives.

Per-session plugin *state*, which Phase 2 needs, becomes a host-provided
persisted service rather than in-memory state.

## Sandbox (Phase 2), de-risked by spike

The spike proved a plugin whose source lives in the database can run with zero
ambient capability and still contribute a tool the chat sees. Full findings and
measurements are in the spike note.

Consequence for Phase 1: the contribution surface must be **data-first and
serializable**, because that is the only thing that crosses a sandbox boundary. A
design handing plugins live JS references would not survive Phase 2.

## Phase 1 delivery stages

Each stage leaves the repository green.

1. **Foundation.** Schema, repository, pure composition, tests. Nothing
   consumes it; behaviour unchanged.
2. **Server tree from the database.** `plugin-core` composes from resolved rows.
   Executors and providers arrive through factories. Identical behaviour while the
   patch table is empty.
3. **Unified catalogue.** Agent capabilities become bundle rows; the resolution
   functions read from the active catalogue; an API route serves the resolved
   catalogue to the client.
4. **Management UI.** Plugin rows are editable from the harness settings dialog.

All four stages are implemented. A write through `/api/harness/plugins`
recomposes the tree in the serving process, and `unregisterExecutor` retires an
executor a new composition dropped, so a removed row stops taking effect without
a restart.

## Testing

The pure composition module carries the bulk of the coverage: layering order,
override semantics, insertion of new rows, disabled rows, unknown factories,
invalid configs, and diagnostics. The route is tested with the repository mocked,
covering row validation and source inference. The catalogue projection is tested
by asserting that an empty patch table reproduces the current static catalogue
exactly, which is the safety property the whole design rests on.
