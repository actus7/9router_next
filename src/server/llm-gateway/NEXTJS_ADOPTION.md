# Next.js API adoption decisions

Policy: adopt selectively, each adoption carries a test and a justification.
There is **no coverage goal** for native APIs; behavior preservation rules.

## Adopted

| API | Where | Why | Test |
|---|---|---|---|
| `onRequestError` | `src/instrumentation.ts` | Typed server error observability for all route types (`render`/`route`/`action`/`proxy`). Additive: only logs, never alters responses. | `tests/unit/instrumentation.test.ts` |
| `instrumentation.register()` | `src/instrumentation.ts` | Owns Node-only startup behind build and HMR guards, keeping layouts free of side effects and preventing duplicate schedulers. | `tests/unit/instrumentation.test.ts` |

## Considered and rejected (with reasons)

| API | Decision | Reason |
|---|---|---|
| `after()` | **Not adopted** for usage tracking / request details | Usage is computed while the response stream is consumed and persisted exactly-once per request today; `after()` cannot re-read the response body, is platform-duration-bound, and moving persistence there would silently downgrade its guarantee (plan §5.2 explicitly forbids this move). No other post-response work exists that needs it. |
| `"use cache"` / `cacheLife` / `cacheTag` | **Not adopted** | `cacheComponents` is not enabled; the cacheable-looking GETs (`/v1/models`, `/api/models`, `/api/pricing`) read per-connection credentials, aliases, disabled models and user pricing overrides — a global cache would leak state across users/instances (plan §5.3). The static table candidates (model metadata, default pricing) are already in-process module constants with no I/O, so caching adds nothing. |
| `connection()` | **Not adopted** | Gateway routes are non-GET (never cached) or runtime-data GETs; no prerender illusion exists to break. Plan §5.4 reserves it for a specific case that does not occur here. |

## Streaming (§5.1)

The engine's `ReadableStream`/`TransformStream` helpers are preserved
unchanged: they implement real SSE protocol semantics (incremental parser,
named events, `[DONE]`, abort propagation, backpressure, usage callbacks).
No simplification was justified — the SSE contract tests
(`tests/unit/sseParser.test.ts`) pin their behavior.
