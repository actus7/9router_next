# Plan 008: Estado em memória do gateway separado por tenant e com tamanho limitado

> **Executor instructions**: Siga o plano; rode cada verificação. STOP conditions → pare e reporte.
>
> **Drift check (rode primeiro)**: `git diff --stat 98d2947..HEAD -- src/server/llm-gateway/engine/services/combo.ts src/server/llm-gateway/engine/services/smart-routing/scoring.ts`

## Status
- **Priority**: P2 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: bug
- **Planned at**: commit `98d2947`, 2026-10-31

## Why this matters
Duas estruturas de módulo do gateway são compartilhadas por todas as contas do processo:
1. **Rotação round-robin de combo** (`comboRotationState`) é chaveada só pelo nome do combo. Duas contas com
   combo "coding" dividem o mesmo cursor: o tráfego de uma muda a ordem de modelos da outra, e salvar o combo
   numa conta reseta a rotação da outra.
2. **Momentum do smart routing** (`routingHistory`) é chaveado pelo `sessionKey`, que vem do cliente
   (`x-session-id`, `body.user`, …) sem prefixo de tenant e sem limite de entradas: uma entrada só sai se a
   mesma chave for relida depois de expirar. Um cliente que manda ids únicos cresce o heap sem fim; ids comuns
   (`body.user = "user"`) fazem o tráfego de uma conta deslocar o tier de outra por 30 min.
Os vizinhos já fazem certo: `modelPenalty.ts:24-30` prefixa com `tryCurrentTenantId()` e limita a 5000 entradas.

## Current state
- `src/server/llm-gateway/engine/services/combo.ts:68` `comboRotationState` (Map). `:199-221` em
  `getRotatedModels(...)`: `const rotationKey = comboName || "__default__";` + `get/set` no Map.
  `:229-232`:
  ```ts
  export function resetComboRotation(comboName?: string): void {
    if (comboName) comboRotationState.delete(comboName);
    else comboRotationState.clear();
  }
  ```
- `src/server/llm-gateway/engine/services/smart-routing/scoring.ts:26` `const routingHistory = new Map<string, HistoryEntry>();`
  `:202-206` `applyMomentum` lê `routingHistory.get(sessionKey)`; `:217-223` `recordRoutingTier(sessionKey, tier)` faz `set`.
- Padrão a copiar: `src/server/llm-gateway/engine/services/modelPenalty.ts:24-30` (abra e leia: prefixo
  `tryCurrentTenantId()` e cap de entradas com evicção do mais antigo — `Map` preserva ordem de inserção).
- `tryCurrentTenantId()` vem de `@/lib/db/tenant` — confira como `modelPenalty.ts` importa (o engine pode usar
  um seam em `engine/host/`; use exatamente o mesmo import que `modelPenalty.ts` usa).

## Scope
**In scope**: `combo.ts` (só rotação), `scoring.ts` (só `routingHistory`), `tests/unit/gatewayStateTenantScope.test.ts` (criar).
**Out of scope**: `modelPenalty.ts`, `comboCacheAffinity.ts`, a lógica de pontuação em si, TTLs.

## Steps
### Step 1: teste que falha
`tests/unit/gatewayStateTenantScope.test.ts`. Use `withTenant("tenant-a", () => ...)` / `withTenant("tenant-b", ...)`
de `@/lib/db/tenant` (ou o mesmo mecanismo que `tests/unit/modelPenalty.test.ts` usa para trocar de tenant —
leia esse arquivo primeiro e copie o padrão). Casos:
1. Rotação: com estratégia round-robin e combo "coding" com modelos `[a,b,c]`, chamar a função exportada que
   usa `getRotatedModels` (descubra o nome exportado/testável em `combo.ts`; se `getRotatedModels` não for
   exportada, exporte-a com comentário `// exported for tests`) duas vezes no tenant A e uma vez no tenant B:
   o B começa em `a`, independente de A.
2. `resetComboRotation("coding")` dentro do tenant B não altera o cursor de A.
3. Momentum: `recordRoutingTier("s1", <tier alto>)` no tenant A não altera o resultado de pontuação de uma
   mensagem curta com `sessionKey "s1"` no tenant B (compare com a pontuação sem `sessionKey`).
4. Cap: gravar `MAX_ROUTING_HISTORY + 10` sessões distintas deixa o Map com no máximo `MAX_ROUTING_HISTORY`
   (exporte o tamanho via uma função de teste `routingHistorySizeForTests()` ou exponha a constante).
**Verify**: `npx vitest run tests/unit/gatewayStateTenantScope.test.ts` → falha.

### Step 2: rotação por tenant
`rotationKey = \`${tryCurrentTenantId() ?? "-"}|${comboName || "__default__"}\``. `resetComboRotation(comboName)`
deleta a chave do tenant corrente; sem argumento, deleta só as chaves com prefixo do tenant corrente (se não
houver tenant, `clear()` como hoje).

### Step 3: momentum por tenant e limitado
Uma função `historyKey(sessionKey) = \`${tryCurrentTenantId() ?? "-"}|${sessionKey.slice(0, 256)}\``, usada em
`applyMomentum` e `recordRoutingTier`. Constante `MAX_ROUTING_HISTORY = 5000`; em `recordRoutingTier`, faça
`delete` antes do `set` (para mover ao fim) e, se `size > MAX_ROUTING_HISTORY`, apague a primeira chave do
iterador. Comentário `// ponytail:`-style não é necessário; um comentário curto citando `modelPenalty.ts` basta.
**Verify**: teste do Step 1 passa; `npx vitest run tests/unit/modelPenalty.test.ts` e todos os testes cujo nome
contém `combo` ou `smartRouting`/`scoring` passam (`npx vitest run tests/unit -t "" --reporter=dot` filtrando
por arquivo: `npx vitest run combo smartRouting scoring`).

### Step 4: gate completo → exit 0.

## Commands
| Propósito | Comando | Sucesso |
|---|---|---|
| Instalar | `npm ci` | exit 0 |
| Gate | `NEON_AUTH_BASE_URL=https://auth.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=ci-build-placeholder-not-a-secret npm run check` | exit 0 |

## Git workflow
Branch `advisor/008-tenant-scope-gateway-memory-state`; commit ex.: `fix(gateway): rotação de combo e momentum do smart routing separados por tenant`.

## Done criteria
- [ ] `grep -n "tryCurrentTenantId" src/server/llm-gateway/engine/services/combo.ts src/server/llm-gateway/engine/services/smart-routing/scoring.ts` → ≥ 2
- [ ] `grep -n "MAX_ROUTING_HISTORY" src/server/llm-gateway/engine/services/smart-routing/scoring.ts` → ≥ 2
- [ ] teste novo (4 casos) passa; gate exit 0; só arquivos in scope

## STOP conditions
- O engine não pode importar `@/lib/db/tenant` diretamente e `modelPenalty.ts` usa outro mecanismo que não
  se aplica aqui.
- Algum teste existente depende de rotação compartilhada sem tenant (falha por isso) — reporte qual.

## Maintenance notes
- Todo novo `Map` de módulo no gateway chaveado por algo vindo do cliente precisa de prefixo de tenant e cap.
