# Plugin Core (Cordis) — Design Spec

## Context

This is sub-project 1 of a larger effort to bring a deepseek-harness (`dsh`)-style
agent playground into squid. `dsh` is built on an "everything is a plugin"
architecture powered by [Cordis](https://github.com/cordiverse/cordis). The user
wants to replicate that architecture faithfully, starting with the plugin engine
itself, before building chat/agent/tooling features on top of it.

Squid's current LLM gateway is **not** plugin-shaped: `executors/index.ts` is a
flat `Record<string, Executor>` of ~30 hand-imported `BaseExecutor` subclasses,
and `providers/registry/index.ts` is a codegen'd flat array of ~140 static
imports. Neither has a context object, dependency declaration, event bus, or
lifecycle (load/unload). There is no existing DI/plugin library in the repo.

## Decision: adopt `cordis` (npm package)

`cordis` is published on npm (MIT, `4.0.0-rc.8`, "Meta-Framework for Modern
Applications"). We use it directly rather than reimplementing a "Cordis-lite"
subset, per YAGNI/laziness — a maintained library beats hand-rolled DI for a
core architectural piece we intend to lean on for every future sub-project.

Cordis mental model used here:
- A **plugin** is a function `(ctx) => void` (or a `Service` subclass) with an
  optional `inject` array declaring which services it depends on.
- A **`Context`** is a repository of named services (`ctx.executors`,
  `ctx.providers`, ...). Plugins consume services by key, never by importing
  concrete implementations directly.
- **`ctx.effect()`** wraps any registration (listener, service entry) so it can
  be cleanly reversed on `ctx.dispose()` — this is what makes hot-reload safe.
- Cross-plugin communication happens via typed events (5 dispatch modes:
  `emit`/`waterfall`/`parallel`/`serial`/`bail`). Not used by sub-project 1;
  documented here because later sub-projects (agent core, tools) will need it.

## Architecture

A new module `src/server/plugin-core/` owns a single root `Context`, created
once per server process:

```
src/server/plugin-core/
  context.ts        # bootstrap(): creates + memoizes the root Context
  types.ts          # SquidPlugin type, typed service map for inject
  wrap-executor.ts  # asPlugin(name, ExecutorClass) adapter
  index.ts          # public exports
```

The root `Context` registers two services on boot, replacing the current flat
registries as the source of truth (the registries' *contents* don't change —
only how they're wired in):

- **`ctx.executors`** — the existing `Record<string, Executor>` becomes a
  service. Each of the ~30 `BaseExecutor` subclasses is wrapped by
  `asPlugin(name, ExecutorClass)`, which does `ctx.executors.register(name, new
  ExecutorClass())` inside `apply(ctx)`. No executor's internal logic
  (`buildHeaders`/`transformRequest`/`execute`/`parseError`) changes.
- **`ctx.providers`** — the ~140-entry codegen'd array becomes a service the
  same way. The generator script (`scripts/`) that currently emits the flat
  array is updated to emit one plugin registration per provider instead;
  investigate the generator before this step to confirm it can target the new
  shape without a rewrite (scope flag, not yet verified).

## Bootstrap and lifecycle

`bootstrap()` in `context.ts` is idempotent: it memoizes the `Context` instance
on `globalThis` (or a module-level singleton guarded by a flag), so Next.js
dev-server hot-reload doesn't create duplicate registrations. All registration
inside plugins goes through `ctx.effect()`, so a future `ctx.dispose()` (e.g.
on hot-reload teardown) cleanly reverses every registration with no manual
bookkeeping.

If any plugin throws during `apply(ctx)` at boot, the error is logged with the
plugin's name and the process fails fast — serving requests against an
incomplete registry is worse than refusing to start.

## Data flow (unchanged behavior)

An API route handling a chat request resolves the singleton `ctx`, calls
`ctx.executors.get(providerId)`, and the existing executor runs exactly as it
does today. Sub-project 1 is a refactor of *where executors live*, not a
behavior change to the gateway. No API route's request/response contract
changes.

## Testing

`plugin-core.test.ts`:
1. Boots the root `Context` and asserts every current executor (by name) and
   every current provider (by id) is registered — parity check against the
   pre-refactor registries (compare against the existing flat exports, not a
   hardcoded list, so the test doesn't rot as providers are added).
2. Asserts `ctx.dispose()` clears all registrations (no leak across
   hot-reload).

## Out of scope (future sub-projects)

Event bus usage, `ctx.sessions`, `ctx.tools`, `ctx.memory`, MCP, scheduling,
GitHub review, Python SDK, the actual chat/agent UI — all later sub-projects,
each with its own spec once this foundation lands.
