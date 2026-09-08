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

## Compatibility

The public gateway protocols remain stable: OpenAI chat/Responses/embeddings, Anthropic, Gemini and SSE. Legacy provider aliases are resolved by the catalog. Schema changes are additive: `syncSchema()` adds missing tables, columns and indexes on boot. A destructive change is run by hand against the Neon branch and then reflected in `schema.ts` — Neon's branching covers the rollback case the old pre-schema backup existed for.
