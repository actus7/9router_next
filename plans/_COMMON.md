# Bloco comum a todos os planos (copiado em cada plano pelo revisor ao despachar)

Este arquivo é referência para humanos. Cada plano repete o que precisa dele.

## Repositório

- ModelHub: gateway LLM multi-tenant compatível com OpenAI + dashboard.
- Next.js 16.4 (App Router, Cache Components), React 19.3, TypeScript, Neon Postgres via adapter próprio
  (`src/lib/db`, placeholders `?`), Neon Auth, Vitest. Testes ficam em `tests/` (não colocados junto ao código).
- Windows é a plataforma de dev primária; use caminhos com `/` em comandos.

## Comandos verificados

Prefixe comandos de shell com `rtk`; use `rtk proxy` quando precisar da saída original. Antes de instalar
dependências num worktree existente, confira se `node_modules` é uma junction/symlink para o checkout
principal. Há worktrees nessa condição: neles não rode `npm ci`/`npm install`, pois compartilhariam as
dependências da sessão de provedores. Instalações e mudanças do lock do 012 exigem dependências próprias.

| Propósito | Comando | Sucesso |
|---|---|---|
| Instalar (worktree novo) | `npm ci` | exit 0 |
| Teste focado | `npx vitest run tests/unit/<arquivo>.test.ts` | todos passam |
| Lint | `npm run lint` | exit 0 |
| Gate completo | `NEON_AUTH_BASE_URL=https://auth.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=ci-build-placeholder-not-a-secret npm run check` | exit 0 |

`npm run check` = lint + contract:check + build + typecheck + test:coverage + check:static-routes + `git diff --check`.
`build` precisa vir antes de `typecheck` (o Next gera os tipos globais `RouteContext`/`PageProps`); por isso
rode `npm run typecheck` sozinho só depois de um `npm run build`.

## Convenções

- Commits: conventional commits em pt-BR, ex.: `fix(gateway): logs de erro do upstream voltam a sair`.
- Toda linha pertence a um tenant (`userId` = id da organização). Dado pessoal usa `MEMBER_ROWS`
  (`src/lib/db/tenant.ts:134`) + coluna `ownerUserId`.
- Schema é declarativo (`src/lib/db/schema.ts`) e sincronizado de forma aditiva no boot: adicionar coluna
  nullable é seguro; nunca renomear/remover.
- Bug fix: escrever o teste que reproduz primeiro, ver falhar, depois corrigir.
