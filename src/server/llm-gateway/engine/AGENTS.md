# llm-gateway engine (formerly open-sse)

Provider-agnostic SSE engine: one OpenAI-style request → any provider (LLM chat, image, embedding, tts, stt, search), streamed back in the client's format.

This is the engine core of the LLM gateway (`src/server/llm-gateway/`). Host code must NOT import it directly — consume it through the gateway barrels (`src/server/llm-gateway/*.ts`, server-only) or `src/shared/llm-catalog` (client-safe metadata).

## Request lifecycle (chat)

`handlers/chatCore.ts` → `services/model.ts` `parseModel` (resolve `provider/model`) → **pre-translate hooks** (`rtk/` tool_result compress, `rtk/headroom.ts` proxy compress, `rtk/caveman.ts` system inject — all fail-open) → `executors/index.ts` `getExecutor(provider)` → `translator/index.ts` `translateRequest` (client format → provider format) → `executor.execute()` (streams upstream) → `translateResponse` (provider chunks → client format) → SSE out.

## Directory map

- `config/` — ALL constants/config (no hardcode elsewhere). `providers.ts`/`registry/` (provider defs), `providerModels.ts` (alias→models matrix), `runtimeConfig.ts` (timeouts, token limits), `*Constants.ts`.
- `translator/` — format conversion. `request/<from>-to-<to>.ts`, `response/<from>-to-<to>.ts`, `schema/` (enums: ROLE, CLAUDE_BLOCK…), `concerns/` (shared logic), `formats.ts`+`formats/` (per-format). `index.ts` is the registry/entry.
- `executors/` — per-provider upstream call. `base.ts` (BaseExecutor), one file per special provider, `index.ts` map.
- `providers/` — registry build + `capabilities.ts` + `pricing.ts`. Entry: `index.ts` (PROVIDERS).
- `handlers/` — per-modality cores (chat/image/embeddings/tts/stt/search/fetch/video) + sub-provider folders. `chatCore/` has the streaming/non-streaming/sse-to-json handlers.
- `rtk/` — request token-killer. `index.ts` compresses `tool_result` content in-place (OpenAI/Claude/Kiro shapes); `filters/` per-tool compressors + `autodetect.ts`; `headroom.ts` external compress proxy; `caveman.ts` system-prompt injector.
- `transformer/` — `streamToJsonConverter.ts` (Chat Completions SSE → Codex Responses API SSE).
- `shared/` — cross-provider auth/identity: `clineAuth.ts`, `machineId.ts`, `zedAuth.ts`, `qoder/`.
- `services/` — `model.ts`, `provider.ts`, `accountFallback.ts`, `combo.ts`, `smart-routing/`, `tokenRefresh/`+`tokenRefresh.ts`, `oauthCredentialManager.ts`, `usage/`, `projectId.ts`, live model resolvers (`kiroModels.ts`/`qoderModels.ts`/…).
- `utils/` — streamHandler, stream, sse, error, sessionManager, claudeCloaking, clientDetector, proxyFetch (patches global fetch), cursorProtobuf/cursorChecksum, ollamaTransform.

## Conventions

- Config-driven, DRY, camelCase. NEVER hardcode values, models, or block/role strings — use `config/` + `schema/` constants.
- Translator pipeline pivots through OpenAI as the intermediate format. A translator registered on the exact `source:target` pair (e.g. `claude:kiro`) runs as a **direct route**, skipping the lossy double-hop.
- Translators self-register via `register(from, to, reqFn, resFn)` as an import side-effect — new files MUST be imported in `translator/index.ts`.

## How to add

- **Provider**: copy `providers/REGISTRY_TEMPLATE.ts` → `providers/registry/{id}.ts`; add models to `config/providerModels.ts`. Generic providers need no executor (DefaultExecutor handles OpenAI-compatible APIs).
- **Executor** (only for non-standard upstream): subclass `BaseExecutor` (override `getBaseUrls`/`buildHeaders`/`buildUrl`/`execute`), register in `executors/index.ts` map. `getExecutor` falls back to `DefaultExecutor` when absent.
- **Translator**: add `request|response/<from>-to-<to>.ts` calling `register(...)`, then import it in `translator/index.ts`. Reuse `schema/` + `concerns/` — don't re-implement parsing.

## Pitfalls

- OpenAI bridge is lossy (thinking, non-base64 images, tool ids, is_error) — prefer a direct route for fragile pairs.
- `registry/index.ts` is an auto-generated static import list; regenerate it (don't hand-edit) after adding a `registry/{id}.ts`. REGISTRY_TEMPLATE is excluded by design.
- Special binary/protobuf formats (kiro EventStream, cursor protobuf, commandcode NDJSON) don't round-trip through OpenAI — handle in their executor.
- `rtk/` + `headroom.ts` mutate the request body in-place and are **fail-open**: any error returns null and leaves the body untouched — never throw out of them. RTK skips `is_error`/`status:"error"` tool results to preserve traces.
