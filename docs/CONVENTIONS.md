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
