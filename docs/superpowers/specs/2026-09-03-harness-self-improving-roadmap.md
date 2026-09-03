# Harness Auto-Melhorável — Roadmap Spec (Fases 1–7)

**Data:** 2026-09-03  
**Status:** Implementado

## Fase 1 — Memória curada
- Tabelas `agentMemoryEntries`, `harnessPendingWrites`
- Tools `memory_*`, `write_approval`, aba Aprendizado
- Spec: `2026-09-03-agent-memory-design.md`

## Fase 2 — FTS5
- `harnessMessageFts`, tool `search_past_sessions`
- Migration `005-harness-message-fts`

## Fase 3 — Review pós-turno
- `/api/harness/learning/review`, nudges heurísticos
- Toggle `learningReviewEnabled` na UI

## Fase 4 — Skills avançadas
- `learn_skill`, `patch_skill`, multi-file (`agentSkillFiles`, `load_skill_file`)
- Journey UI na aba Aprendizado

## Fase 5 — Governança
- `toggle_plugin`, `propose_harness_capability`, pending staging
- `/api/harness/governance`

## Fase 6 — Sandbox
- QuickJS-WASM via `@jitl/quickjs-singlefile-cjs-release-sync`
- `/api/harness/sandbox/eval` (JSON-in/JSON-out, `registerTool`)

## Fase 7 — UX
- Aba **Aprendizado** (memória + governança + journey)
- Export JSON de memória e skills
