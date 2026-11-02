# Plan 010: Escrita pendente de memória pessoal é aplicada na memória de quem a pediu

> **Executor instructions**: Siga o plano; rode cada verificação. STOP conditions → pare e reporte.
>
> **Drift check (rode primeiro)**: `git diff --stat 98d2947..HEAD -- src/lib/db/schema.ts src/lib/db/repos/harnessPendingWritesRepo.ts src/server/harness/memory/applyMemoryWrite.ts`

## Status
- **Priority**: P2 · **Effort**: M · **Risk**: MED · **Depends on**: none (conflito de merge com 009 em `applyMemoryWrite.ts`) · **Category**: security
- **Planned at**: commit `98d2947`, 2026-10-31

## Why this matters
Memória de escopo `user` é privada de cada membro (linhas com `ownerUserId`, lidas por `MEMBER_ROWS`). Quando
uma escrita dessas vai para a fila de aprovação (`harnessPendingWrites`), a fila **não guarda quem pediu**.
Ao aprovar, o código reaplica a escrita no contexto de quem aprovou (o admin), e a inserção carimba
`currentActorUserId()` — o admin. Resultado: a memória pessoal do membro vai parar na memória privada do admin
e o membro nunca a recebe; um `replace/remove` pendente de entrada pessoal do membro é procurado na visão do
admin, dá "não encontrado" e fica pendente para sempre. Depois deste plano, a linha pendente guarda
`ownerUserId` e a aprovação de escrita `user` roda como esse dono.

## Current state
- `src/lib/db/schema.ts:511-529` — tabela `harnessPendingWrites`: colunas `id, userId, kind, action, payload,
  source, status, reviewedAt, result, risk, createdAt`; **sem** `ownerUserId`. Outras tabelas declaram
  `ownerUserId: "TEXT"` com o comentário `// The member the row belongs to; NULL = the tenant owner (see MEMBER_ROWS).`
  (ex. `schema.ts:306-307`). O schema é sincronizado de forma aditiva no boot: adicionar coluna nullable é seguro.
- `src/lib/db/repos/harnessPendingWritesRepo.ts`:
  - `:17-32` `rowToPending(row)`; `:51-77` `insertHarnessPendingWrite(write, status)` faz
    `INSERT INTO harnessPendingWrites(id, userId, kind, action, payload, source, status, risk, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  - os SELECTs listam colunas explicitamente (`SELECT id, kind, action, payload, source, status, reviewedAt, result, risk, createdAt FROM ...`).
- `src/server/harness/memory/applyMemoryWrite.ts:229-246` `approvePendingWrite(id)`:
  ```ts
  if (pending.kind === "memory") {
    const payload = pending.payload;
    const result = await applyMemoryWrite({ action: pending.action as MemoryApplyAction, scope: payload.scope === "user" ? "user" : "agent", id: ..., content: ..., source: "ui" });
    if (result.ok) { await resolveHarnessPendingWrite(id, "applied", { outcome: "applied" }); }
  ```
- `src/lib/db/tenant.ts`: `withTenant(owner: string | TenantContext, fn)`, `currentTenantContext()`,
  `currentActorUserId()`, `TenantContext { tenantId, actorUserId, role }`.
- Os tipos `HarnessPendingWrite` / `NewHarnessPendingWrite` — ache com `grep -rn "interface HarnessPendingWrite\|type HarnessPendingWrite" src`.

## Scope
**In scope**: `src/lib/db/schema.ts` (uma coluna), `src/lib/db/repos/harnessPendingWritesRepo.ts`, o arquivo de
tipo de `HarnessPendingWrite` (só adicionar `ownerUserId?: string`), `src/server/harness/memory/applyMemoryWrite.ts`
(só `approvePendingWrite`), `tests/unit/pendingWriteOwner.test.ts` (criar).
**Out of scope**: esconder escritas `user` de outros membros na listagem (`GET /api/harness/pending`) — follow-up;
skills/plugins pendentes; migração de linhas antigas (ficam com `ownerUserId` NULL = comportamento atual).

## Steps
### Step 1: teste que falha
`tests/unit/pendingWriteOwner.test.ts`, mocks no estilo de `tests/unit/pendingWrites.test.ts`:
1. `insertHarnessPendingWrite` chamado dentro de `withTenant({ tenantId:"t1", actorUserId:"m1", role:"member" })`
   emite INSERT cujo SQL contém `ownerUserId` e cujos params contêm `"m1"`.
2. `approvePendingWrite(id)` executado como admin (`actorUserId:"a1"`) para uma pendente `{ kind:"memory", payload:{ scope:"user", ... }, ownerUserId:"m1" }`
   chama `applyMemoryWrite` (ou a inserção) com `currentActorUserId() === "m1"` no momento da chamada
   (capture o ator dentro do mock).
3. Pendente `scope:"agent"` aprovada por `a1` roda como `a1` (sem troca).
4. Pendente `scope:"user"` com `ownerUserId` ausente (linha antiga) roda como o aprovador (comportamento atual).
**Verify**: `npx vitest run tests/unit/pendingWriteOwner.test.ts` → falha.

### Step 2: coluna e repo
- `schema.ts`: em `harnessPendingWrites.columns`, adicione `ownerUserId: "TEXT",` com o comentário padrão.
- Repo: INSERT inclui `ownerUserId` com `currentActorUserId()`; todos os SELECTs incluem `ownerUserId`;
  `rowToPending` copia `ownerUserId` quando presente. Tipo ganha `ownerUserId?: string`.
- O schema tem um hash (`_meta.schemaHash`); mudar `schema.ts` muda o hash — esperado. Se houver um teste de
  snapshot de schema que falhe, atualize o snapshot pelo comando que o próprio teste indica e liste em NOTES.

### Step 3: aprovar como o dono
Em `approvePendingWrite`, no ramo `memory`: se `payload.scope === "user"` e `pending.ownerUserId` existe e é
diferente de `currentActorUserId()`, envolva a chamada a `applyMemoryWrite` em
`withTenant({ ...currentTenantContext(), actorUserId: pending.ownerUserId, role: "member" }, () => applyMemoryWrite(...))`.
O `resolveHarnessPendingWrite` continua fora (no contexto do admin — ele filtra só por tenant).
**Verify**: teste novo passa; `npx vitest run tests/unit/pendingWrites.test.ts tests/unit/memoryScope.test.ts tests/unit/skillWriteApproval.test.ts tests/unit/jevWriteRisk.test.ts tests/unit/tenantIsolation.test.ts` → passam.

### Step 4: gate completo → exit 0 (inclui `contract:check` — se `schema.ts` alimentar o contrato Prisma e
`contract:check` falhar por diff em `src/prisma/contract.*`, rode `npm run contract:emit`, commite os arquivos
gerados e liste em NOTES).

## Commands
| Propósito | Comando | Sucesso |
|---|---|---|
| Instalar | `npm ci` | exit 0 |
| Gate | `NEON_AUTH_BASE_URL=https://auth.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=ci-build-placeholder-not-a-secret npm run check` | exit 0 |

## Git workflow
Branch `advisor/010-pending-write-owner`; commit ex.: `fix(harness): escrita pendente de memória pessoal volta para o dono ao ser aprovada`.

## Done criteria
- [ ] `grep -n "ownerUserId" src/lib/db/repos/harnessPendingWritesRepo.ts` → ≥ 3
- [ ] `grep -n -A14 "harnessPendingWrites: {" src/lib/db/schema.ts | grep ownerUserId` → 1
- [ ] teste novo (4 casos) passa; gate exit 0; arquivos = in scope (+ gerados listados)

## STOP conditions
- Rodar `applyMemoryWrite` sob `withTenant` com o ator trocado esbarra em checagem de papel (ex.: exige admin)
  — reporte em vez de elevar o papel.
- `tenantIsolation.test.ts` reclama da query nova.

## Maintenance notes
- Linhas antigas sem `ownerUserId` mantêm o comportamento antigo — só afeta pendências criadas antes do deploy.
- Follow-up de privacidade: a fila mostra ao admin o texto de memória pessoal dos membros.
