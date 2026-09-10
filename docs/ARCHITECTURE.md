# ModelHub architecture

## Boundaries

- `src/app/api` adapts HTTP only. It validates input, delegates to the domain, and serializes the public contract.
- `src/server/llm-gateway` owns protocol translation, account selection, provider execution and fallback. Its `engine` is isolated from Next.js and local storage details through `engine/host` seams.
- `src/server/llm-gateway/auth` is a **peer of `engine`, not inside it**, and reaches `src/lib/db/repos` directly — `connectionsRepo`, `proxyPoolsRepo`, `apiKeysRepo`, `modelAvailabilityRepo`, `settingsRepo`. `tests/unit/hostSeam.test.ts` covers what is under `engine/`, so the seam is exhaustive for the engine and not for the gateway as a whole. Read "everything the gateway touches is in `host/`" and you will underestimate the surface by those five repos; account selection, the mutex and the fallback loop all live here. Kept this way on purpose: the seam exists for testability, and `accountSelection` is already testable by mocking those repos.
- `src/shared/llm-catalog` is the server registry projection. `src/shared/constants/providers.ts` is its typed, client-safe dashboard projection; UI code must use its selectors instead of recoding category or authentication rules.
- `src/lib/db` owns persistence. One database — Neon Postgres — reached through a single adapter that translates `?` placeholders and restores camelCase column names, so repo SQL reads the way it always did. The schema is declarative (`schema.ts`) and synced additively on boot; there is no versioned migration chain. Provider availability is normalized in `modelAvailability`; `providerConnections.testStatus` means a connection test result only.
- **Every row belongs to an account.** Each table but `_meta` carries `userId`, every repo filters on it, and the owner rides an `AsyncLocalStorage` established at four entry points: `tenantRoute` (dashboard API), `gatewayRoute` (API key), `assertDashboardSession` / `requireTenantPage` (Server Actions and Components), and `forEachTenant` (background jobs). Reaching tenant data with no owner throws rather than returning rows. Two tests hold the line: `tenantIsolation` reads the SQL, `tenantRouteCoverage` reads the routes. See `docs/NEON-MIGRATION.md`.
- Identity is Neon Auth and only Neon Auth. There is no operator password, no OIDC/SAML and no way to disable login, because "logged out" would mean "owns nothing".

## Provider model

Each provider has a unique `id`, user-facing alias, category, optional explicit authentication modes, capabilities and discovery flags. Categories organize the dashboard; commercial availability is derived by `getProviderAvailability`, and connection matching by `getProviderConnectionAuthTypes`.

Per-model failures (`402`, `429`, `502`, `503` and model-specific errors) create an availability record with reason, sanitized error and expiry. They never mark the entire connection unavailable. Batch operations must be bounded, cancellable in the UI and report progress; automated tests use mocks only.

## Durable runs

A chat send does not depend on the browser that started it. `POST /api/harness/runs`
writes a `harnessRuns` row, answers `202` immediately, and runs the provider
call afterwards under `waitUntil` — closing the tab, or the laptop, stops
nothing. The worker rewrites `partialText` about once a second and settles
`status` at the end; `GET /api/harness/runs/[runId]/stream` replays what has
accumulated before following along, so a client that reconnects sees the whole
answer rather than only what arrived after it returned.

Three things are deliberate:

- **The worker writes the finished answer into `harnessConversations`.** It did
  not, and could not: the client replaced that table wholesale on every
  `PUT /api/harness/sessions`, so a background write was raced away. That left
  the answer living only in `harnessRuns`, waiting to be folded in by
  `useDurableRunRecovery` — which reads only the session that happens to be
  open, and only if a browser comes back at all. Settled rows expire after
  `SETTLED_RUN_TTL_MS`, so a laptop closed for a day lost an answer the account
  had already paid for.

  Sync is incremental now (`syncHarnessConversations`): it upserts what the
  client says changed, deletes only ids it is told to delete, and refuses an
  upsert older than the stored row — reporting it in `stale` so the client
  re-reads rather than overwriting. That is what makes a server-side write
  safe, and it is what makes the browser one reader of the conversation instead
  of its owner. `useDurableRunRecovery` still collects run rows, but it is now
  how a *live* tab catches up, not the only path an answer has.

  A turn that asked for tools is mirrored as `error`, not `done`: it is not
  finished, and the loop that would continue it runs in the browser. Writing it
  as an answer would file a truncated turn as a complete one; not writing it at
  all left it to expire in `harnessRuns` with nothing said. Its unanswered
  calls ride along and are dropped when the conversation is next serialized.
- **Stop and navigating away are different.** Aborting locally only stops
  watching. An explicit stop `PATCH`es the row to `stopped`; the worker learns
  about it because its next progress `UPDATE ... WHERE status = 'running'`
  matches nothing.
- **A dead worker is settled by its reader.** A serverless invocation can be
  killed without reaching its own error handler — a timeout, a deploy, a dev
  server recompile. The worker therefore touches its row every 5s whatever the
  provider is doing, so silence means death rather than slowness, and any run
  quiet for `STALE_RUN_MS` (60s) is failed by the next reader. Reaping happens
  inside the watcher's poll loop, not only when it connects: the worker can die
  after a watcher has already attached, and a watcher that never reaches a
  terminal state leaves the client's send promise unsettled and its composer
  disabled.
- **A stream that ends without a terminal status is a truncated answer**, and
  the client raises it as one. Returning the fragment as a result would file an
  interrupted answer as a finished message, silently.
- **A live run is never swept.** `replaceHarnessConversations` prunes runs for
  sessions missing from a sync payload, but skips `running` rows — deleting one
  under its worker loses the answer with nothing to report it. Settled rows
  also expire after `SETTLED_RUN_TTL_MS`, so a run nobody collects still goes.

Ceilings, all per-account and per-process like the rate limiter beside them:
`MAX_CONCURRENT_RUNS` (12) bounds work in flight, `MAX_WATCHERS_PER_ACCOUNT`
(8) bounds open watchers — each polls Neon on a timer, and Neon is shared by
every tenant — and the delete endpoint caps its id list. The dashboard rate
limit bounds how fast these are *started*, never how many are alive, which is
the quantity that costs anything.

The ceiling is that `maxDuration`: one run must finish inside one invocation.
Tool calls still execute in the browser (`runToolCallLoop`), so each step is
durable but the loop between steps is not — a tab that dies mid-loop keeps the
step that was in flight and stops there, and that step is not mirrored into the
conversation because it is not an answer. Durability across invocations, and
loops that continue without the client, would need Vercel Workflow or Queues.

**This is the one remaining way a closed browser changes the outcome.** A turn
with no tool calls now completes and lands in the conversation whether anyone
is watching or not; a turn that needs a second tool step still waits for a
browser. Closing it means running the tool executors server-side — most of what
`executeRuntimeToolCall` reaches is already an HTTP route on this server — plus
somewhere for an approval-gated write to wait for its operator.

## Compatibility

The public gateway protocols remain stable: OpenAI chat/Responses/embeddings, Anthropic, Gemini and SSE. Legacy provider aliases are resolved by the catalog. Schema changes are additive: `syncSchema()` adds missing tables, columns and indexes on boot. A destructive change is run by hand against the Neon branch and then reflected in `schema.ts` — Neon's branching covers the rollback case the old pre-schema backup existed for.
