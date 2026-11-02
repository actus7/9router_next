# Plan 009: Membro não escreve direto na memória compartilhada da equipe

> **Executor instructions**: Siga o plano; rode cada verificação. STOP conditions → pare e reporte.
>
> **Drift check (rode primeiro)**: `git diff --stat 98d2947..HEAD -- src/server/harness/memory/applyMemoryWrite.ts src/server/application/use-cases/http/harness/memory/route.ts`

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: security
- **Planned at**: commit `98d2947`, 2026-10-31
- **Conflito de merge**: toca `applyMemoryWrite.ts`, como o plano 010. Faça o merge de um, rebase do outro.

## Why this matters
A memória de escopo `agent` é da **equipe**: o texto é injetado nas conversas de todos os membros. O
caminho do operador (`PUT /api/harness/memory`) exige admin para esse escopo. Mas o caminho do agente
(`POST`, alcançável por qualquer membro — o único gate é `sessionHasPlugin`, e o membro liga o plugin na
própria conversa) aceita `scope: "agent"`. Com `memoryWriteApproval` desligado (padrão), a escrita é aplicada
direto. Ou seja: qualquer membro grava instruções persistentes no contexto de todo mundo, contornando o
admin-only do PUT. Depois deste plano, quando quem age é `member` e o escopo é `agent`, a escrita **sempre**
vai para a fila de aprovação (sem auto-aplicação por risco), qualquer que seja `memoryWriteApproval`.

## Current state
- `src/server/application/use-cases/http/harness/memory/route.ts:112-140` — `POST`: valida `action`,
  exige `sessionId` e `sessionHasPlugin(sessionId, "tool-memory")`, fixa `source = "agent"` e chama
  `applyMemoryWrite({ action, scope, id, content, source })`.
- `src/server/harness/memory/applyMemoryWrite.ts` (função `applyMemoryWrite`, ~linhas 148-226):
  - resolve `scope` (para `replace/remove`, vem da entrada existente);
  - ramo 1: `if (request.source === "agent" && config.memoryWriteApproval && request.action !== "remove") { scan; pendingWrite; const risk = await assessWriteRisk(pendingWrite); if (canAutoApplyWrite(config.writeRiskMode, risk)) { ...applyDirect...; return autoApplied } await queuePendingWrite(pendingWrite, { risk }); return { ok: true, pending: true, pendingId } }`
  - ramo 2: `if (request.source === "agent" && config.memoryWriteApproval && request.action === "remove") { queuePendingWrite({... action: "remove", payload: { scope, id } ...}); return pending }`
  - senão `applyDirect(...)`.
- Papel de quem age: `currentTenantContext().role` de `@/lib/db/tenant` (`"owner" | "admin" | "member"`).
- Testes de padrão: `tests/unit/memoryRoute.test.ts`, `tests/unit/memoryScope.test.ts`, `tests/unit/pendingWrites.test.ts`.

## Scope
**In scope**: `src/server/harness/memory/applyMemoryWrite.ts`, `tests/unit/memberAgentMemory.test.ts` (criar).
**Out of scope**: a rota (`memory/route.ts`), `PUT`, escopo `user` (o membro continua dono da própria memória),
`queuePendingWrite`, skills/governança.

## Steps
### Step 1: teste que falha
`tests/unit/memberAgentMemory.test.ts`, copiando os mocks de `tests/unit/memoryScope.test.ts` (ou
`pendingWrites.test.ts` — o que já chama `applyMemoryWrite` com config mockada). Use `withTenant({ tenantId: "t1", actorUserId: "m1", role: "member" }, ...)`. Com `memoryWriteApproval: false`:
1. member + `source:"agent"` + `scope:"agent"` + `add` → resultado `pending: true`; `queuePendingWrite` chamado; a função de inserção direta **não**.
2. member + `scope:"agent"` + `remove` de uma entrada agent existente → `pending: true`.
3. member + `scope:"user"` + `add` → aplicado direto (sem fila).
4. admin (`role:"admin"`) + `scope:"agent"` + `add` → aplicado direto (comportamento atual).
5. member + `scope:"agent"` + `add` com `writeRiskMode:"auto"` e risco mockado baixo → **ainda** `pending: true` (sem auto-aplicar).
**Verify**: `npx vitest run tests/unit/memberAgentMemory.test.ts` → casos 1, 2, 5 falham.

### Step 2: implementar
Logo após resolver `scope` e as checagens de habilitação, calcule:
```ts
// A member's agent-path write to the team's shared memory always waits for an admin:
// PUT (the operator path) already requires admin for this scope.
const memberWritesShared = request.source === "agent" && scope === "agent" && tryCurrentTenantContext()?.role === "member";
const needsApproval = request.source === "agent" && (config.memoryWriteApproval || memberWritesShared);
```
(Use a função "try" do contexto se existir em `@/lib/db/tenant`; se só existir `currentTenantContext()`, use-a
dentro de try/catch e trate ausência como não-member.) Troque `config.memoryWriteApproval` por `needsApproval`
nos dois ramos, e no ramo 1 só tente `canAutoApplyWrite` quando `!memberWritesShared`.
**Verify**: teste novo passa; `npx vitest run tests/unit/memoryRoute.test.ts tests/unit/memoryScope.test.ts tests/unit/pendingWrites.test.ts tests/unit/writeRiskAuto.test.ts tests/unit/postTurnReview.test.ts` → passam.

### Step 3: gate completo → exit 0.

## Commands
| Propósito | Comando | Sucesso |
|---|---|---|
| Instalar | `npm ci` | exit 0 |
| Gate | `NEON_AUTH_BASE_URL=https://auth.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=ci-build-placeholder-not-a-secret npm run check` | exit 0 |

## Git workflow
Branch `advisor/009-member-agent-memory-requires-approval`; commit ex.: `fix(harness): escrita de membro na memória da equipe vai para aprovação`.

## Done criteria
- [ ] `grep -n "memberWritesShared" src/server/harness/memory/applyMemoryWrite.ts` → ≥ 3
- [ ] teste novo (5 casos) passa; testes listados passam; gate exit 0; só arquivos in scope

## STOP conditions
- Um teste existente afirma que membro aplica escrita `agent` direto.
- `applyMemoryWrite` é chamado por algum caminho de **aprovação** com `source: "agent"` (o approve usa
  `source: "ui"` hoje — confirme com grep); se usar `"agent"`, a mudança criaria laço de fila → STOP.

## Maintenance notes
- O post-turn review (`postTurnReview.ts`) chama este mesmo caminho; escritas `agent` vindas de conversa de
  membro passam a cair na fila — esperado.
- Escrita de skill por membro (`PUT /api/harness/skills/agent`) tem problema análogo; ficou fora (depende do Jev).
