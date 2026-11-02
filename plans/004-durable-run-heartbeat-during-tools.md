# Plan 004: Run durável não é dada como morta enquanto uma ferramenta demora

> **Executor instructions**: Siga o plano; rode cada verificação. STOP conditions → pare e reporte.
>
> **Drift check (rode primeiro)**: `git diff --stat 98d2947..HEAD -- src/server/application/use-cases/harness/durableRun.ts src/lib/db/repos/harnessRunsRepo.ts`

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: bug
- **Planned at**: commit `98d2947`, 2026-10-31

## Why this matters
O worker de uma run durável grava `updatedAt` a cada 5 s ("heartbeat") para que silêncio signifique morte:
qualquer leitor falha uma run `running` parada há mais de `STALE_RUN_MS` (60 s). Mas o heartbeat só roda
durante a leitura do primeiro stream; ele é desligado **antes** do laço de ferramentas
(`runServerToolLoop`). Dentro do laço, `updatedAt` só é tocado quando sai texto de progresso. Uma etapa de
ferramenta longa — poll de vídeo (orçamento de 90 s), MCP lento, continuação de modelo que raciocina — passa
de 60 s sem escrita, e o leitor marca a run como `failed`. O worker termina, o `settleHarnessRun` final não
casa com linha nenhuma, a resposta já paga se perde e o usuário vê "servidor interrompido".

## Current state
- `src/server/application/use-cases/harness/durableRun.ts`:
  - `:58` `const HEARTBEAT_INTERVAL_MS = 5_000;`
  - `:242-261` o heartbeat é um `setInterval` criado antes do `while (!progress.stopped)` de leitura e limpo
    no `finally { clearInterval(heartbeat); }` logo após.
  - `:279-313` em seguida: `const loop = parsed.toolCalls.length ? await runServerToolLoop({ ..., onProgress: (text) => { publishRunText(runId, text); return updateHarnessRunProgress(runId, text); }, onToolEvent: async (type, data) => { await setHarnessRunActivity(...).catch(() => undefined); ... } }) : null;`
- `src/lib/db/repos/harnessRunsRepo.ts`:
  - `:52` `export const STALE_RUN_MS = 60 * 1000;`
  - `:116-123` `updateHarnessRunProgress(id, partialText)` → `UPDATE harnessRuns SET partialText = ?, updatedAt = ? WHERE ${MEMBER_ROWS} AND id = ? AND status = ?` com params `[partialText, new Date().toISOString(), ...memberRowParams(), id, "running"]`, retorna `result.changes > 0`.
  - `:132-138` `setHarnessRunActivity` não toca `updatedAt` (de propósito: é só legenda).
- `src/server/harness/tools/serverMediaTools.ts:42` `const VIDEO_POLL_BUDGET_MS = 90_000;`
- Testes de padrão: `tests/unit/durableRun.test.ts`, `tests/unit/durableRunHardening.test.ts` (mockam o repo
  e `runServerToolLoop`).

## Scope
**In scope**: `src/lib/db/repos/harnessRunsRepo.ts` (nova função), `src/server/application/use-cases/harness/durableRun.ts`,
`tests/unit/durableRunToolHeartbeat.test.ts` (criar).
**Out of scope**: `STALE_RUN_MS`, `VIDEO_POLL_BUDGET_MS`, `serverToolLoop.ts`, o leitor (`runs/stream/route.ts`),
o heartbeat da fase de leitura.

## Steps
### Step 1: teste que falha
Crie `tests/unit/durableRunToolHeartbeat.test.ts` seguindo os mocks de `tests/unit/durableRunHardening.test.ts`
(ou `durableRun.test.ts` — escolha o que já mocka `runServerToolLoop`). Cenário: o primeiro turno devolve
tool calls; `runServerToolLoop` mockado só resolve depois de `vi.advanceTimersByTimeAsync(65_000)`.
Asserção: a nova função `touchHarnessRun` (mock do repo) foi chamada ≥ 10 vezes durante o laço, e após o laço
resolver, avançar mais 20 s **não** gera chamadas novas (intervalo limpo).
**Verify**: `npx vitest run tests/unit/durableRunToolHeartbeat.test.ts` → falha.

### Step 2: `touchHarnessRun` no repo
```ts
/** Keeps a live run from looking dead while a tool step runs: bumps only `updatedAt`. */
export async function touchHarnessRun(id: string): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `UPDATE harnessRuns SET updatedAt = ? WHERE ${MEMBER_ROWS} AND id = ? AND status = ?`,
    [new Date().toISOString(), ...memberRowParams(), id, "running"],
  );
}
```

### Step 3: heartbeat em volta do laço de ferramentas
Em `durableRun.ts`, troque o `await runServerToolLoop({...})` por:
```ts
const toolHeartbeat = setInterval(() => { void touchHarnessRun(runId).catch(() => undefined); }, HEARTBEAT_INTERVAL_MS);
try { loop = await runServerToolLoop({...}); } finally { clearInterval(toolHeartbeat); }
```
(Mantenha a semântica: `loop` é `null` quando não há tool calls — o intervalo só existe nesse ramo.) Ajuste o
mock do repo nos testes existentes de `durableRun*` **só se** eles quebrarem por falta de `touchHarnessRun` no
mock (adicionar `touchHarnessRun: vi.fn()` ao factory é aceitável e deve ser listado em NOTES).
**Verify**: `npx vitest run tests/unit/durableRunToolHeartbeat.test.ts tests/unit/durableRun.test.ts tests/unit/durableRunHardening.test.ts tests/unit/durableRunEndToEnd.test.ts tests/unit/durableRunNonBlocking.test.ts tests/unit/durableRunPush.test.ts tests/unit/durableRunStream.test.ts` → todos passam.

### Step 4: gate completo → exit 0.

## Commands
| Propósito | Comando | Sucesso |
|---|---|---|
| Instalar | `npm ci` | exit 0 |
| Gate | `NEON_AUTH_BASE_URL=https://auth.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=ci-build-placeholder-not-a-secret npm run check` | exit 0 |

## Git workflow
Branch `advisor/004-durable-run-heartbeat-during-tools`; commit ex.: `fix(harness): heartbeat da run continua durante o laço de ferramentas`.

## Done criteria
- [ ] `grep -n "export async function touchHarnessRun" src/lib/db/repos/harnessRunsRepo.ts` → 1
- [ ] `grep -n "touchHarnessRun" src/server/application/use-cases/harness/durableRun.ts` → ≥ 2 (import + uso)
- [ ] teste novo passa; testes `durableRun*` passam; gate exit 0; só arquivos in scope (+ factories de mock nos testes, se necessário, listados em NOTES)

## STOP conditions
- `runServerToolLoop` não é chamado no ponto descrito.
- Um teste existente de `durableRun*` falha por motivo diferente da falta de `touchHarnessRun` no mock.

## Maintenance notes
- Qualquer nova fase longa do worker (fora da leitura e do laço) precisa do mesmo heartbeat.
- `tests/unit/tenantIsolation.test.ts` lê o SQL dos repos: a query nova usa `MEMBER_ROWS`, então deve passar.
