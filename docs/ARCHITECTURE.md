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

- **The worker never writes `harnessConversations`.** The client replaces that
  table wholesale on every `PUT /api/harness/sessions`, so a background write
  would be raced away. Finished runs wait in `harnessRuns` until
  `useDurableRunRecovery` folds them into the session the user next opens —
  which is the moment they came back to read it — and are deleted after.
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
step that was in flight and stops there. Durability across invocations, and
loops that continue without the client, would need Vercel Workflow or Queues.

## Compatibility

The public gateway protocols remain stable: OpenAI chat/Responses/embeddings, Anthropic, Gemini and SSE. Legacy provider aliases are resolved by the catalog. Schema changes are additive: `syncSchema()` adds missing tables, columns and indexes on boot. A destructive change is run by hand against the Neon branch and then reflected in `schema.ts` — Neon's branching covers the rollback case the old pre-schema backup existed for.
