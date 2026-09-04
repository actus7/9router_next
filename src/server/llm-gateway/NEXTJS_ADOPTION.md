# Next.js API adoption decisions

Policy: adopt selectively, each adoption carries a test and a justification.
There is **no coverage goal** for native APIs; behavior preservation rules.

## Adopted

| API | Where | Why | Test |
|---|---|---|---|
| `onRequestError` | `src/instrumentation.ts` | Typed server error observability for all route types (`render`/`route`/`action`/`proxy`). Additive: only logs, never alters responses. | `tests/unit/instrumentation.test.ts` |
| `instrumentation.register()` | `src/instrumentation.ts` | Owns Node-only startup behind build and HMR guards, keeping layouts free of side effects and preventing duplicate schedulers. | `tests/unit/instrumentation.test.ts` |
| `connection()` | `src/server/application/http/requestRuntime.ts` (`assertRequestRuntime`), called from 40+ API routes | `cacheComponents: true` (enabled in `next.config.ts`) makes a runtime-data GET look static to Next unless something in the request is touched — this is that opt-out. `scripts/check-static-api-routes.mjs` fails the build if a route was baked at build time instead. | `scripts/check-static-api-routes.mjs` (build-time), route unit tests mock it directly |

## Considered and rejected (with reasons)

| API | Decision | Reason |
|---|---|---|
| `after()` | **Not adopted** for usage tracking / request details | Usage is computed while the response stream is consumed and persisted exactly-once per request today; `after()` cannot re-read the response body, is platform-duration-bound, and moving persistence there would silently downgrade its guarantee (plan §5.2 explicitly forbids this move). No other post-response work exists that needs it. |
| `"use cache"` / `cacheLife` / `cacheTag` | **Not adopted** for the gateway's request-serving GETs | The cacheable-looking GETs (`/v1/models`, `/api/models`, `/api/pricing`) read per-connection credentials, aliases, disabled models and user pricing overrides — a global cache would leak state across users/instances (plan §5.3). The static table candidates (model metadata, default pricing) are already in-process module constants with no I/O, so caching adds nothing. `cacheComponents: true` is enabled project-wide; this row is about the gateway's own routes, not the flag. |

## Streaming (§5.1)

The engine's `ReadableStream`/`TransformStream` helpers are preserved
unchanged: they implement real SSE protocol semantics (incremental parser,
named events, `[DONE]`, abort propagation, backpressure, usage callbacks).
No simplification was justified — the SSE contract tests
(`tests/unit/sseParser.test.ts`) pin their behavior.
