# Plan 012: Zerar os advisories críticos e altos de dependências de produção

> **Executor instructions**: Siga o plano; rode cada verificação. STOP conditions → pare e reporte.
> Este plano mexe em `package.json`/`package-lock.json`; leia a seção "npm ci falha no CI" abaixo antes.
>
> **Drift check (rode primeiro)**: `git diff --stat 98d2947..HEAD -- package.json package-lock.json`

## Status
- **Priority**: P1 · **Effort**: S–M · **Risk**: MED · **Depends on**: none · **Category**: migration
- **Planned at**: commit `98d2947`, 2026-10-31
- **Implemented**: `4d2d5ef`, 2026-11-01, com a correção de seletor do 016; revisão de dependências aprovada.

## Why this matters
`npm audit --omit=dev` em 2026-10-31 relatou 1 crítico e 6 altos em dependências de produção: o crítico é
`better-auth`, transitivo de `@neondatabase/auth` (`^0.7.0-beta`, a pilha de autenticação — a superfície mais
sensível do app); os altos incluem `@neondatabase/auth`, `@neondatabase/auth-ui` e `@vercel/functions` →
`@vercel/oidc` → `@vercel/cli-config` → `zod` (esgotamento de memória ao validar coleções grandes).
`@vercel/functions` está em 3.10.3 com 3.10.5 dentro do range.

Atualização de 2026-11-01: a auditoria voltou a indicar **1 critical, 6 high e 6 low**. Isso comprova a
presença das dependências afetadas; não comprova exploração do login local nem vulnerabilidade do serviço
Neon remoto. `src/lib/auth/server.ts:29-35` cria um cliente para esse serviço.

## Current state
- `package.json` dependências relevantes: `"@neondatabase/auth": "^0.7.0-beta"`, `"@vercel/functions": "^3.10.3"`.
  O projeto já usa o bloco `"overrides"` em `package.json` (leia-o).
- Lock atual: `better-auth@1.7.6` sob `@neondatabase/auth`, Zod `4.5.4` e uma cópia `4.1.11` sob
  `@vercel/cli-config`. Correções publicadas e verificadas em 2026-11-01: Better Auth `1.7.7`
  (GHSA-965c-763c-88jm e GHSA-r4xp-prcw-77qf) e Zod `4.6.6` (GHSA-mrhx-c7xc-m3w5).
- `@neondatabase/auth` não tem outra versão na linha 0.7 no registry consultado. O caminho a investigar é
  override patch de Better Auth, seguido de validação de compatibilidade; `fixAvailable.isSemVerMajor`
  do audit não elimina essa possibilidade.
- Imports de `@neondatabase/auth`: `grep -rn "@neondatabase/auth" src` (≈ 6 lugares; fluxos em `src/app/auth/*`
  e `src/lib/auth/*`).
- **Armadilha documentada (`docs/CONVENTIONS.md` → "Erros conhecidos")**: o npm no Windows não grava as
  entradas de pacotes de plataforma do lockfile e o `npm ci` do CI (Linux) recusa com "Missing: ... from lock
  file". Depois de mexer no lock, rode:
  ```bash
  npx -y npm@10.9.2 install --package-lock-only --include=optional
  npx -y npm@10.9.2 ci --dry-run --include=optional
  ```
  e confira que a mudança do lock é aditiva/esperada **campo a campo** (versões alteradas, entradas removidas),
  não pelo tamanho do diff.
- Reconciliação do lock: o npm 10 pode retirar `@prisma/config/node_modules/effect@3.20.0`,
  `fast-check@3.23.2` e `pure-rand@6.1.0`, embora o `@prisma/config` inalterado continue exigindo o Effect.
  Preserve/restaure as entradas originais dessas dependências sem alterar suas versões e valide o lock
  com `ci --dry-run`; não aceite sua remoção como deduplicação. A remoção de
  `@opentelemetry/semantic-conventions` é permitida se a nova árvore Better Auth não a exigir mais.

## Scope
**In scope**: `package.json`, `package-lock.json`. Ajustes de código em `src/lib/auth/*` / `src/app/auth/*`
**somente** se uma atualização patch/minor de `@neondatabase/auth` mudar um tipo — e listados em NOTES.
**Out of scope**: subir `next`, `react`, `prisma` ou qualquer outra dependência não citada; advisories `low`;
devDependencies.

## Steps
### Step 1: linha de base
`npm ci` e `npm audit --omit=dev --json > /tmp/audit-before.json; npm audit --omit=dev` — anote contagem por
severidade e o `fixAvailable` de cada advisory crítico/alto.
### Step 2: `@vercel/functions`
`npm install @vercel/functions@^3.10.5` (atualização dentro do range). A versão 3.10.5 continua trazendo
`@vercel/oidc@4.0.5` → `@vercel/cli-config@0.3.5` → `zod@4.1.11`: atualizar só Functions não corrige o advisory.
Use overrides restritos às subárvores afetadas para Zod `4.6.6` ou outra versão corrigida na major 4,
incluindo a cópia pinada no Neon SDK. Confira `npm ls zod` e o audit de novo; preserve as demais majors.
### Step 3: `better-auth` / `@neondatabase/auth`
`npm view @neondatabase/auth versions --json` e `npm view better-auth versions --json`. Ordem de preferência:
(a) uma versão mais nova de `@neondatabase/auth` na **mesma linha 0.7.x** que traga `better-auth` corrigido;
(b) `overrides` de `better-auth` para a menor versão corrigida **com a mesma major/minor** que a requerida por
`@neondatabase/auth` (`npm ls better-auth`). Se só existir correção numa minor/major diferente → STOP.
O patch `1.7.6` → `1.7.7` cabe nessa regra. Verifique também as versões de `@better-auth/*` exigidas pelo
SDK e pelo patch, sem forçar uma família incompatível ou esconder conflitos de peer dependencies.
O plugin `@better-auth/api-key@1.7.12` já instalado exige `better-auth^1.7.12`; alinhar a família em
`1.7.12` continua na mesma linha permitida. Investigue separadamente o conflito preexistente entre seu
peer `better-call@1.4.4` e o `better-call@2.0.2` de Davey UI. Não force downgrade de major dessa UI;
prefira layout/patch compatível na subárvore e reporte qualquer conflito remanescente com comparação à base.
No npm 11, o seletor deve reconhecer tanto o pedido antigo quanto a versão instalada/peers. A solução
validada no 016 é `"better-call@1.4.x": "1.4.4"` no nível raiz dos overrides; o seletor exato `1.4.0`
continuava marcando a cópia `1.4.4` como inválida. Os consumidores de `1.4.x` estão na árvore Neon, e
`2.0.2` da UI permanece intacto. `npm ls` validou o resultado em npm 10 e npm 11.
### Step 4: lockfile para o CI
Rode a receita do npm 10 acima.
**Verify**: `npx -y npm@10.9.2 ci --dry-run --include=optional` → exit 0.
### Step 5: verificação
**Verify**: `npm audit --omit=dev` → 0 critical, 0 high (se sobrar algum sem correção publicada, registre o id
do advisory em NOTES e siga); gate completo → exit 0.

## Commands
| Propósito | Comando | Sucesso |
|---|---|---|
| Gate | `NEON_AUTH_BASE_URL=https://auth.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=ci-build-placeholder-not-a-secret npm run check` | exit 0 |

## Git workflow
Branch `advisor/012-npm-audit-prod-deps`; commit ex.: `chore(deps): corrige advisories críticos/altos de better-auth e zod`.

## Done criteria
- [ ] `npm audit --omit=dev` sem `critical`; `high` = 0 ou cada um remanescente justificado em NOTES (sem correção publicada)
- [ ] `npx -y npm@10.9.2 ci --dry-run --include=optional` exit 0
- [ ] gate exit 0; `git diff --stat` = `package.json`, `package-lock.json` (+ ajustes de auth listados)
- [ ] NOTES lista cada versão alterada no lock (de → para)

## STOP conditions
- A correção exige mudar major/minor de `@neondatabase/auth` ou `better-auth`.
- O lock passa a alterar versões de pacotes fora da subárvore de `@vercel/functions`/`@neondatabase/auth`.
- O build/typecheck quebra em código de auth após a atualização.

## Maintenance notes
- Fluxos de login precisam de verificação manual no navegador após o merge (não há E2E de auth).
- `@neondatabase/auth` é beta; registrar a versão estável alvo quando sair.
