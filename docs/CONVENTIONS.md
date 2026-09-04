# Convenções do projeto

Referenciado pelo `AGENTS.md` raiz (que preserva o bloco gerado pelo `next dev` — não editar aquele bloco).

## Tamanho de arquivo

- Alvo: 200-400 linhas por componente/módulo.
- Acima de ~600 linhas, decompor antes de adicionar mais lógica ao arquivo.
- Não é uma regra rígida para arquivos de dados/config gerados (ex.: `src/server/llm-gateway/engine/providers/registry/*`, `src/prisma/contract.d.ts`).

## Client components grandes (dashboard)

Para telas com muito estado interativo (`providers/[id]`, `basic-chat`, `usage/*`):

1. **Extrair hooks customizados por área de estado**, não deixar tudo em `useState` solto no componente. Um hook por domínio (ex.: `useProviderConnections`, `useProviderModels`), não um hook por `useState`.
2. **Extrair componentes de seção** que recebem o hook ou seus dados via props. O componente de página fica como orquestrador fino: monta os hooks, renderiza seções e modais compartilhados.
3. Não copiar o padrão do modelhub aqui — o `chat-page.tsx` de referência lá tem 3.764 linhas num componente só, sem hooks extraídos. É o exemplo do que não fazer.

## Organização de pastas

- `components/` e páginas do dashboard: feature-based (uma pasta por área: `providers/`, `basic-chat/`, `usage/`), não por tipo genérico (`containers/`, `presentational/`).
- Backend do gateway LLM: bounded context único em `src/server/llm-gateway/` (ver `ARCHITECTURE.md` para as regras de dependência entre `app/`, `server/llm-gateway` e `shared/llm-catalog`). Não espalhar lógica do gateway em `src/lib/utils`, `src/lib/services` etc.

## Testes

- Ficam em `tests/` (não colocados junto ao código-fonte) — convenção já estabelecida no projeto, mantida deliberadamente.
- Framework: Vitest (`npm run test`).

## shadcn/ui e Tailwind

- Tailwind v4 CSS-first: tema em `src/app/globals.css` via `@theme inline` + tokens OKLCH. Não criar `tailwind.config.js`.
- Componentes shadcn ficam em `src/components/ui/`; não duplicar um primitive existente — checar `components.json` → `aliases.ui` antes de gerar um novo.

## Dead code

- `no-unused-vars`/`noUnusedLocals` não estão ligados globalmente hoje (ver comentário em `eslint.config.mjs`). Isso significa que o TypeScript/IDE não bloqueia código morto automaticamente — ao tocar um arquivo, remover imports/variáveis/funções não usadas que você encontrar nele, mesmo que não sejam o foco da mudança.

## Settings sem UI — intencional vs. omissão

A linha única de `settings` tem chaves que nenhuma tela edita. Elas **não** são
todas o mesmo problema, e tratá-las como um bloco produz ou 9 controles inúteis
ou 9 omissões perpetuadas. A classificação:

**Env-only por decisão** (tuning ou dependência externa, não escolha de produto —
editar por `PATCH /api/settings` ou variável de ambiente):

- `observabilityMaxRecords`, `observabilityBatchSize`, `observabilityFlushIntervalMs`, `observabilityMaxJsonSize` — tuning do buffer de `requestDetails`. Só `enableObservability` tem UI, que é a escolha real.
- `headroomEnabled`, `headroomUrl`, `headroomCompressUserMessages` — dependem de um processo externo em `localhost:8787`.
- `pxpipeAutoInstall`, `pxpipeTimeoutMs` — tuning; o resto do pxpipe já tem UI.

**Aguardando um segundo caso**: `tunnelProvider` só tem um provider implementado
(`cloudflare`); um seletor de um item é ruído. Adicionar quando houver o segundo.

**Tinha UI faltando, corrigido**: `freeFallbackEnabled` mudou *para onde o prompt
do usuário vai* quando as contas esgotam e não tinha controle nenhum. Hoje está
em `profile/sections/RoutingCard.tsx`.

A regra: uma chave sem UI **documentada como decisão** não é gap. O gap era não
saber a diferença.

## Definição de pronto

Antes de reportar qualquer tarefa como concluída, rodar `npm run check` (lint + contract:check + build + typecheck + test:coverage + check:static-routes + git diff --check) e confirmar que sai verde.

**A ordem não é arbitrária: `build` tem que vir antes de `typecheck`.** O Next gera
`RouteContext` e `PageProps` como tipos globais em `.next/types`, que o
`tsconfig.json` inclui, e é o `next build` que os escreve. Com `typecheck` antes,
um checkout limpo — sem `.next` — falha com ~25 erros `TS2304: Cannot find name
'RouteContext'`. Localmente isso passava despercebido porque um `next dev`
anterior já tinha deixado os tipos no disco; no CI, que sempre começa limpo,
o `check` falhava sempre. `next typegen` existe mas não produziu os diretórios
que o `tsconfig` inclui nesta versão. Para mudanças em `server/llm-gateway`, `shared/llm-catalog` ou `app/api`, isso já roda automaticamente via o hook em `.claude/settings.json`.

Ao corrigir um bug: escreva um teste que reproduza o bug primeiro, confirme que ele falha pelo motivo esperado, e só então corrija a implementação — sem editar o teste.

## Erros conhecidos

_(vazio — populado quando um erro do Claude realmente se repetir duas vezes, formato erro → correção)_
