# Plan 007: Agregados diários de uso e contadores do tenant não perdem incrementos sob concorrência

> **Executor instructions**: Siga o plano; rode cada verificação. STOP conditions → pare e reporte.
>
> **Drift check (rode primeiro)**: `git diff --stat 98d2947..HEAD -- src/lib/db/repos/usageRepo.ts src/lib/db/helpers/tenantMeta.ts`

## Status
- **Priority**: P2 · **Effort**: M · **Risk**: MED · **Depends on**: none · **Category**: bug
- **Planned at**: commit `98d2947`, 2026-10-31

## Why this matters
`saveRequestUsage` roda em toda requisição de chat/embedding/falha. Dentro da transação ele lê o blob JSON
de `usageDaily` do dia, altera em JS e regrava — **sem lock de linha**. No isolamento padrão do Postgres
(READ COMMITTED), duas requisições da mesma conta no mesmo dia leem o mesmo blob e a segunda escrita apaga os
incrementos da primeira: o dashboard e os custos diários sub-contam. Se a linha do dia ainda não existe, as
duas inserem e o `ON CONFLICT DO UPDATE SET data = excluded.data` também sobrescreve. O contador
`totalRequestsLifetime` (`bumpTenantMeta`) tem o mesmo read-then-write, e `bumpTenantMeta` também é usado para
os números de revisão de memória/skills/plugins.

## Current state
- `src/lib/db/repos/usageRepo.ts:444-492`, dentro de `db.transaction(async () => { ... })`:
  ```ts
  const dateKey: string = getLocalDateKey(entry.timestamp);
  const row = await db.get(`SELECT data FROM usageDaily WHERE userId = ? AND dateKey = ?`, [userId, dateKey]) as { data: string } | undefined;
  const day: DayData = row ? (parseJson(row.data, {}) as DayData) : {
    requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
  };
  aggregateEntryToDay(day, entry);
  await db.run(`INSERT INTO usageDaily(userId, dateKey, data) VALUES(?, ?, ?) ON CONFLICT(userId, dateKey) DO UPDATE SET data = excluded.data`, [userId, dateKey, stringifyJson(day)]);
  await bumpTenantMeta(db, "totalRequestsLifetime");
  ```
- `src/lib/db/helpers/tenantMeta.ts:26-39`:
  ```ts
  export async function setTenantMeta(db, key, value) { await db.run(`INSERT INTO kv(userId, scope, key, value) VALUES(?, ?, ?, ?) ON CONFLICT(userId, scope, key) DO UPDATE SET value = excluded.value`, [currentTenantId(), SCOPE, key, String(value)]); }
  /** Increments a counter and returns the new value. Call inside a transaction. */
  export async function bumpTenantMeta(db, key): Promise<number> {
    const next: number = (Number(await getTenantMeta(db, key)) || 0) + 1;
    await setTenantMeta(db, key, next);
    return next;
  }
  ```
  `kv.value` é TEXT. Chamadores de `bumpTenantMeta`: `usageRepo.ts`, `agentMemoryRepo.ts:72,88,96`,
  `agentSkillsRepo.ts:74,96`, `pluginRowsRepo.ts:71`.
- Precedente de lock no projeto: `src/lib/db/repos/harnessConversationsRepo.ts` usa `SELECT ... FOR UPDATE`
  dentro de `db.transaction` (o adapter mantém a transação numa conexão só).
- `db.get` com `RETURNING` já é usado (`usageRepo.ts`, o INSERT de `usageHistory ... RETURNING id`).
- Banco é Postgres (Neon); o adapter traduz `?` para `$n`. Casts `::bigint` funcionam.

## Scope
**In scope**: `src/lib/db/repos/usageRepo.ts` (só o bloco de `usageDaily`), `src/lib/db/helpers/tenantMeta.ts`,
`tests/unit/usageDailyLocking.test.ts` (criar). Ajuste de factories de mock de `db.get` em testes existentes
que quebrarem por causa da mudança de `bumpTenantMeta` é permitido, listado em NOTES.
**Out of scope**: normalizar `usageDaily` em linhas por dimensão (mudança maior, follow-up); o SELECT de
duplicata de `usageHistory`; `getTenantMeta`/`setTenantMeta` (mantêm assinatura e comportamento).

## Steps
### Step 1: teste que falha
`tests/unit/usageDailyLocking.test.ts`, no estilo de `tests/unit/harnessConversationsRepo.test.ts` (mocka
`@/lib/db/driver` com spies `run/get/transaction` e confere o SQL emitido). Casos:
1. `bumpTenantMeta(db, "x")` emite **uma** chamada `db.get` cujo SQL contém `ON CONFLICT` e `RETURNING value`
   e nenhuma chamada a `SELECT value FROM kv`; devolve o número retornado (mock `{ value: "7" }` → `7`).
2. Ao salvar uso (`saveRequestUsage` — veja a assinatura no arquivo e monte uma entrada mínima), a sequência
   de SQL contém um `INSERT INTO usageDaily ... ON CONFLICT ... DO NOTHING` **antes** de um
   `SELECT data FROM usageDaily ... FOR UPDATE`.
Se montar `saveRequestUsage` com mocks exigir mais de ~4 módulos mockados, teste só o caso 1 e registre em NOTES.
**Verify**: `npx vitest run tests/unit/usageDailyLocking.test.ts` → falha.

### Step 2: contador atômico
```ts
/** Increments a counter atomically and returns the new value. */
export async function bumpTenantMeta(db: DbAdapter, key: string): Promise<number> {
  const row = (await db.get(
    `INSERT INTO kv(userId, scope, key, value) VALUES(?, ?, ?, '1')
     ON CONFLICT(userId, scope, key) DO UPDATE
       SET value = ((CASE WHEN kv.value ~ '^[0-9]+$' THEN kv.value::bigint ELSE 0 END) + 1)::text
     RETURNING value`,
    [currentTenantId(), SCOPE, key],
  )) as { value: string } | undefined;
  return Number(row?.value) || 1;
}
```

### Step 3: lock da linha do dia
Substitua a leitura por: (a) `await db.run(\`INSERT INTO usageDaily(userId, dateKey, data) VALUES(?, ?, '{}') ON CONFLICT(userId, dateKey) DO NOTHING\`, [userId, dateKey]);`
(b) `SELECT data FROM usageDaily WHERE userId = ? AND dateKey = ? FOR UPDATE`; (c) se o JSON parseado não
tiver `requests` numérico (linha recém-criada com `'{}'`), use o objeto default atual. O `INSERT ... ON CONFLICT
DO UPDATE SET data = excluded.data` final pode virar `UPDATE usageDaily SET data = ? WHERE userId = ? AND dateKey = ?`
(a linha já existe) — escolha o UPDATE.
**Verify**: `npx vitest run tests/unit/usageDailyLocking.test.ts` → passa.

### Step 4: regressões
Tire uma linha de base de `npx vitest run tests/unit --reporter=dot` **antes** do Step 2. Depois:
**Verify**: mesma suíte sem falhas novas. Testes de `agentMemoryRepo`/`agentSkillsRepo`/`pluginRowsRepo` que
mockavam `getTenantMeta` + `setTenantMeta` podem quebrar; ajuste somente o mock (não as asserções de
comportamento) e liste em NOTES.

### Step 5: gate completo → exit 0. `tests/unit/tenantIsolation.test.ts` deve passar (as queries filtram `userId`).

## Commands
| Propósito | Comando | Sucesso |
|---|---|---|
| Instalar | `npm ci` | exit 0 |
| Gate | `NEON_AUTH_BASE_URL=https://auth.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=ci-build-placeholder-not-a-secret npm run check` | exit 0 |

## Git workflow
Branch `advisor/007-usage-daily-no-lost-updates`; commit ex.: `fix(usage): agregado diário e contadores sem perda de incremento sob concorrência`.

## Done criteria
- [ ] `grep -n "FOR UPDATE" src/lib/db/repos/usageRepo.ts` → ≥ 1
- [ ] `grep -n "RETURNING value" src/lib/db/helpers/tenantMeta.ts` → 1
- [ ] teste novo passa; gate exit 0; arquivos alterados = in scope (+ mocks listados)

## STOP conditions
- Uma asserção de comportamento (não de mock) em teste existente falha.
- `db.transaction` do adapter não roda numa conexão única (procure em `src/lib/db/driver.ts`/adapter); sem
  isso `FOR UPDATE` não protege — reporte.

## Maintenance notes
- O lock serializa as escritas de uso de **uma conta num dia**; é o comportamento correto, mas sob tráfego
  muito alto por conta vira ponto de contenção. A saída de longo prazo é normalizar `usageDaily` com
  `SET requests = requests + 1` por dimensão.
