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
  client says changed, deletes only ids it is told to delete — recording a
  tombstone so the deletion converges on every device instead of being
  re-uploaded by whichever one still had a local copy — and refuses an upsert
  older than the stored row — reporting it in `stale` so the client
  re-reads rather than overwriting. That is what makes a server-side write
  safe, and it is what makes the browser one reader of the conversation instead
  of its owner. `useDurableRunRecovery` still collects run rows, but it is now
  how a *live* tab catches up, not the only path an answer has.

  A turn the worker could not finish — out of tool steps, or out of its time
  budget — is mirrored as `error`, not `done`. Writing it as an answer would
  file a truncated turn as a complete one; not writing it at all left it to
  expire in `harnessRuns` with nothing said. Its unanswered calls ride along and
  are dropped when the conversation is next serialized.
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

**The tool loop runs in the worker** (`server/harness/tools/serverToolLoop.ts`),
so a turn that needs several tool steps finishes with nothing open. Everything
the browser's executor reaches is an HTTP route on this same server, so the work
already lived here; what lived only in the browser was the loop. Dispatch is
in-process rather than over HTTP, which is also what makes it possible: the
harness routes authenticate with the dashboard session, which a worker does not
have, while an in-process call runs inside the run's `withTenant(owner)`.

`runToolCallLoop` in the browser is still there, and still needed. Two rules
keep the two loops from ever both running a call:

- **A step is all-or-nothing.** Every tool the harness ships runs in the
  worker: search, fetch, delegation, MCP, the harness's own skill/memory/
  governance tools, and media generation. The browser loop is the safety net
  for a tool the worker has no executor for — a future one, or an MCP name that
  is not in the request body. If any call in a step is unknown to the worker,
  none of them run there and the whole set is settled onto the row, which is
  where `executeDurableChat` reads tool calls from.
- **A hand-back only happens before the worker has run anything.** Once it has,
  the earlier tool results exist only in the worker's own message list, so a
  browser continuing the chain would send a history missing them. The turn ends
  there instead and is reported unfinished.

The worker writes `tool/call` and `tool/result` into the run journal, so
server-side tool work is visible rather than text appearing from nowhere.

**Two accidents of environment had to be replaced, not moved.** The browser
base64-encoded generated audio with `btoa`, walking the bytes through
`String.fromCharCode` in 32KB chunks because that is all it had; the worker uses
`Buffer`. And the browser bounded a video poll with an `AbortSignal`, which the
worker does not have — a stop reaches it as a progress write that matches no
row. So every wait in the worker is bounded by the run's own deadline instead.

That deadline is the real ceiling: one run, every tool step included, must
finish inside one invocation (`maxDuration` 300s, and the loop gives itself
`RUN_BUDGET_MS` 240s). A video poll alone was allowed 90s, and eight of those
would be killed by the platform mid-step — leaving the row `running` for the
next reader to settle as dead, losing the whole chain. The loop watches its own
clock and stops in a state it can report. Loops genuinely longer than one
invocation need Vercel Workflow or Queues.

The one thing a browser is still required for is a model that *is* the browser:
Puter runs the completion inside `js.puter.com`, so `executeSendMessage`
branches before the durable path and such a run never becomes a durable run at
all. An approval-gated write no longer needs the browser — the worker queues it
and the operator answers whenever they next look.

## Compatibility

The public gateway protocols remain stable: OpenAI chat/Responses/embeddings, Anthropic, Gemini and SSE. Legacy provider aliases are resolved by the catalog. Schema changes are additive: `syncSchema()` adds missing tables, columns and indexes on boot. A destructive change is run by hand against the Neon branch and then reflected in `schema.ts` — Neon's branching covers the rollback case the old pre-schema backup existed for.
