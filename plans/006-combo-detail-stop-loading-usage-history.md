# Plan 006: A página de combo de mídia para de carregar todo o histórico de uso

> **Executor instructions**: Siga o plano; rode cada verificação. STOP conditions → pare e reporte.
>
> **Drift check (rode primeiro)**: `git diff --stat 98d2947..HEAD -- "src/app/(dashboard)/dashboard/media-providers/combo/[id]/"`

## Status
- **Priority**: P2 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: perf
- **Planned at**: commit `98d2947`, 2026-10-31

## Why this matters
Cada visita a `/dashboard/media-providers/combo/[id]` chama `getUsageLogs({})`, que faz
`SELECT ... FROM usageHistory WHERE userId = ? ORDER BY id ASC` **sem LIMIT** (a tabela nunca é podada e cada
linha tem um JSON `tokens`), serializa tudo para o cliente — e o cliente descarta tudo, porque filtra
`typeof l === "string"` sobre objetos. O painel de logs fica sempre vazio. Custo crescente, benefício zero.
Remover a leitura não muda nada que o usuário veja.

## Current state
- `src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.tsx:3` importa `getUsageLogs` de `@/lib/data-access`;
  `:14-21` `Promise.all([getComboById(id), getSettings(), getProviders(), getApiKeys(), getModelAliases(), getUsageLogs({})])`;
  `:35` passa `initialLogs={logs as unknown[]}`.
- `.../ComboDetailClient.tsx:101-103`:
  ```ts
  const [logs] = useState<string[]>(
    (initialLogs || []).filter((l: unknown) => typeof l === "string" && l.includes(initialCombo?.name || "")).slice(0, 50) as string[]
  );
  ```
  Procure no mesmo arquivo onde `logs` é renderizado e a prop `initialLogs` é declarada no tipo de props.

## Scope
**In scope**: os dois arquivos acima.
**Out of scope**: `src/lib/data-access.ts`, `src/lib/db/repos/usageRepo.ts` (`getUsageLogs`/`getUsageHistory`
têm outros chamadores); criar um painel de logs funcional (follow-up, se o produto quiser).

## Steps
### Step 1: remover a leitura e a prop
- `page.tsx`: tire `getUsageLogs` do import e do `Promise.all` (ajuste a desestruturação), e tire a prop
  `initialLogs`.
- `ComboDetailClient.tsx`: remova a prop `initialLogs` do tipo, o `useState` de `logs` e o bloco de UI que
  renderiza `logs` (ele nunca mostrava nada — se for um card inteiro "Logs", remova o card). Remova imports
  que ficarem sem uso.
**Verify**: `grep -rn "initialLogs\|getUsageLogs" "src/app/(dashboard)/dashboard/media-providers/combo/[id]/"` → nada.

### Step 2: gate completo → exit 0 (lint pega import morto; build pega prop faltando).

## Commands
| Propósito | Comando | Sucesso |
|---|---|---|
| Instalar | `npm ci` | exit 0 |
| Gate | `NEON_AUTH_BASE_URL=https://auth.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=ci-build-placeholder-not-a-secret npm run check` | exit 0 |

## Git workflow
Branch `advisor/006-combo-detail-stop-loading-usage-history`; commit ex.: `perf(combos): página de combo de mídia não lê mais o histórico de uso inteiro`.

## Done criteria
- [ ] grep do Step 1 vazio; gate exit 0; só os 2 arquivos modificados

## STOP conditions
- O bloco de UI de `logs` também mostra outra coisa que funciona (ex.: resultado de teste) — remova só a
  parte de `logs` e explique em NOTES; se não der para separar, STOP.
- Algum teste em `tests/` referencia `initialLogs` (rode `grep -rn initialLogs tests`).

## Maintenance notes
- Se um painel de logs por combo for desejado, ele precisa de query própria com `LIMIT` e filtro por modelo,
  não `getUsageHistory`.
