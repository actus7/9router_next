# Plan 015: Montar e verificar uma candidata isolada para produção

## Status e intenção

P1 · M · MED · planejado em `98d2947`, 2026-11-01. Continuação do pedido original de terminar as revisões
e preparar para produção. O advisor só edita `plans/`; um executor separado monta a candidata.
Não fazer merge na `main`, push, deploy, mudança no banco ou na sessão de provedores.

## Estado atual

`main` está em `98d2947` e contém alterações locais independentes em provedores/sidebar. Não copiá-las.
Os commits dos planos revisados estão em branches/worktrees separados:

| Plano | Commit(s) |
|---|---|
| 001 | `a996980` |
| 003 | `00fdf07` |
| 004 | `e5f329a` |
| 005 | `fd541a7` |
| 006 | `1e24dff`, `a6e3872` |
| 007 | `6270ba7` |
| 008 | `f893885` |
| 009 | `c86724f` |
| 010 | `aef851d` |
| 011 | `770809d` |
| 012 / 016 | `4d2d5ef`, revisão de grafo, lock e audit concluída |
| 014 | `8eaea7e` |

O 002 continua suspenso: `prompt.md` é fonte histórica do perfil MetaBreak, citado em comentário;
o perfil está numa constante independente. Não remover o recurso nem o documento nesta candidata.
O 013 adiciona caracterização do core e atualiza pisos usando medição da candidata, conforme abaixo.

## Convenções e escopo

Next 16.4.2, React 19.3, TS 6, Vitest 5, npm. Testes em `tests/`, imports via `@/`.
Leia os guias relevantes em `node_modules/next/dist/docs/` antes de escrever código Next.
Prisma 8 usa `prisma.config.ts` + `src/prisma/contract.prisma`; emissão não é migração.
O schema aditivo do adapter legado em `src/lib/db/schema.ts` é separado desse contrato.
Não inferir que a coluna legada do 010 exige mudar o contrato Prisma: conferir o gate real primeiro.
O engine acessa serviços externos por `engine/host/`, sem novos imports diretos de persistência/shared.

Arquivos em escopo: os diffs dos commits listados, resolução mínima de imports em
`src/server/harness/memory/applyMemoryWrite.ts` para preservar 009 e 010, `vitest.config.ts` somente
thresholds/comentário de medição, e `tests/unit/chatCoreCharacterization.test.ts` novo.
Gerados do build/contrato somente se houver mudança semântica necessária comprovada; relatar antes de commit.
Não alterar outras fontes para contornar testes, thresholds ou erros de build. Logs fora do Git.

## Passos

1. Criar worktree próprio sob `.claude/worktrees/` e branch `advisor/integration` a partir de `98d2947`,
   somente se ainda não existirem; se existirem, conferir estado e preservar trabalho anterior.
   Cherry-pick dos commits na ordem da tabela. O 010 vem depois de 009; combine os imports de tenant e
   preserve tanto a fila obrigatória de membro quanto a aplicação da memória pessoal como dono.
   Pode preparar os commits disponíveis enquanto espera 012; não validar a candidata final sem ele.
   Verificar `git diff --name-only 98d2947..HEAD` contra a união dos escopos; nenhum diff de provedores.

2. Dependências: não ligar à `node_modules` principal. Após 012 aprovado, pode ligar à árvore própria
   instalada e conferida do worktree 012, com manifest/lock idênticos, sem instalar nela outra vez.
   Alternativa é `npm ci` numa árvore realmente própria. Não copiar `.env` ou credenciais. Usar placeholders
   de CI só no processo de build; não contatar Neon ou providers reais.

3. Teste de integração local dos planos: Vitest para `proxyEndpointGuard`, `gatewayLoggerLines`,
   `memberAgentMemory`, `pendingWriteOwner`, `usageDailyLocking`, `extractApiKey` e `gatewayStateTenantScope`.
   Todos devem passar. `git diff --check 98d2947..HEAD` deve sair 0.

4. Executar o 013 nesta candidata: criar `tests/unit/chatCoreCharacterization.test.ts`, usando os testes
   live existentes apenas como padrão de montagem dos argumentos. Não rodar testes live nem rede real.
   Importar `handleChatCore` real; mockar borda de rede e serviços de banco/settings necessários,
   no máximo seis módulos. Três casos afirmando saída: SSE OpenAI com dois deltas em ordem e `[DONE]`,
   status 200; `attemptSignal` já abortado produzindo o erro/abort observado; upstream 500 JSON com
   status e mensagem de erro. Não alterar `src/` se aparecer bug: relatar. Cleanup de globals/timers.
   Rodar teste focado e cobertura focada: statements de `chatCore.ts` maior que zero.

5. Gerar os artefatos exigidos pelo prebuild antes da medição completa; a extensão ZIP não está em
   worktrees novos e há teste que a exige. Medir cobertura atual da candidata com `npm run test:coverage`.
   Definir pisos globais medidos menos 0,5, com uma casa decimal; pisos por arquivo medidos menos 2,
   limitados a 80, em `application/accessScope.ts`, `server/application/http/usageLimits.ts` e smart router
   (primeiro caminho completo é `src/server/llm-gateway/application/accessScope.ts`).
   Não usar artefato histórico de coverage. Atualizar comentário da config com data e medição.
   Se mocks exigirem mais de seis módulos, parar a caracterização e relatar antes de aceitar piso isolado.

6. Entregar a candidata ao advisor para rodar o gate completo uma vez após todos os commits e ajustes: lint, contract:check, build, typecheck,
   test:coverage e diff:check, conforme `package.json`. Usar um processo filho com
   `NEON_AUTH_BASE_URL=https://auth.invalid/neondb/auth` e
   `NEON_AUTH_COOKIE_SECRET=ci-build-placeholder-not-a-secret`, sem imprimir ambiente.
   Relatar etapa exata e log em caso de falha. Não enfraquecer gate nem editar teste para esconder regressão.
   Rodar `npm audit --omit=dev`: zero critical/high. Rodar dry-run do lock npm 10 conforme 012 se ainda
   não comprovado para o mesmo lock. Nenhuma migração ou escrita em banco remoto.

7. Commitar somente arquivos permitidos da caracterização/pisos e resoluções de integração.
   Entregar branch, commits, comandos/resultados, scope/diff, pendências e verificações não exercidas.
   Gate verde não comprova login/browser/deploy. Não declarar produção atualizada.

## Comandos (sempre prefixados por RTK)

`rtk proxy node node_modules/vitest/vitest.mjs run <arquivos>`: todos passam.
`rtk proxy npm run prebuild`: artefatos emitidos, exit 0.
`rtk proxy npm run test:coverage`: todos passam e pisos atendidos.
`rtk proxy npm run check`: exit 0 com todas as etapas concluídas.
`rtk proxy npm audit --omit=dev`: zero critical/high.
`rtk proxy git diff --check 98d2947..HEAD`: exit 0.

## STOP e manutenção

Parar se 012 não estiver aprovado ao iniciar gate final, surgir conflito semântico além dos imports
009/010, precisar editar outra fonte ou configuração, ou houver falha de verificação após duas tentativas
razoáveis. Relatar bloqueio para o advisor ajustar o plano; não improvisar.
Não tocar em junctions existentes, locks, transcrição histórica, `main` ou dados de produção.
Nenhum plano DONE implica merge/deploy; a validação identifica precisamente o commit candidato.
