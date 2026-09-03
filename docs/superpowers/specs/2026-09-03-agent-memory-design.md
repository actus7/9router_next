# Agent Memory — Design

**Data:** 2026-09-03  
**Status:** Aprovado (Fase 1 do roadmap Harness auto-melhorável)

## Objetivo

Memória curada persistente (agent + user) com limites rígidos, tools runtime, write_approval com fila pending, e bloco congelado no system prompt.

## Modelo

- `agentMemoryEntries(id, scope, content, createdAt, updatedAt)` — scope `agent` | `user`
- Limites: agent 2200 chars, user 1375 chars (total por scope)
- `harnessPendingWrites` — staging quando `write_approval: true`

## Runtime

Plugin `tool-memory` → `memory_add`, `memory_replace`, `memory_remove`  
Bundled skill `memory-guide` ensina quando persistir.

## Config (_meta)

- `harness.memory.writeApproval` — default `true`
- `harness.memory.agentEnabled` / `userEnabled` — default `true`
