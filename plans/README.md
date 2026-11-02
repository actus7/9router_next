# Planos de implementação

Gerados pelo `/improve` em 2026-10-31, sobre o commit `98d2947`. Cada plano é autocontido. Executores: leiam
o plano inteiro, respeitem as STOP conditions e atualizem sua linha. Cada plano roda num worktree próprio a
partir de `98d2947`; **ordem de merge** abaixo.

## Ordem de execução e status

| Plano | Título | Prioridade | Esforço | Depende de | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Proxy pools e embeddings passam pelo guard de endpoint privado | P1 | S | — | DONE — `a996980`, revisão e 19 testes focados em 2026-11-01; gate na candidata |
| 002 | Remover `prompt.md` (texto de override para agentes) | P1 | S | — | BLOCKED — é a fonte do perfil MetaBreak (`engine/config/metabreak.ts:1`); decisão do dono |
| 003 | Falhas de upstream voltam ao log, com segredos mascarados | P1 | S | — | DONE — `00fdf07`, revisão e 17 testes focados em 2026-11-01; gate na candidata |
| 004 | Heartbeat da run durável durante o laço de ferramentas | P1 | S | — | DONE — `advisor/004-durable-run-heartbeat-during-tools` (e5f329a), revisado; gate na integração |
| 005 | Uma leitura de API key no gate e no handler | P1 | S | — | DONE — `advisor/005-unify-gateway-api-key-extraction` (fd541a7), revisado; gate na integração |
| 006 | Combo de mídia não lê o histórico de uso inteiro | P2 | S | — | DONE — `advisor/006-combo-detail-stop-loading-usage-history` (1e24dff, a6e3872), revisado; gate na integração |
| 007 | `usageDaily` e contadores sem perda de incremento | P2 | M | — | DONE — `advisor/007-usage-daily-no-lost-updates` (6270ba7), revisado; SQL validado em Postgres real (temp tables); gate na integração |
| 008 | Rotação de combo e momentum separados por tenant | P2 | S | — | DONE — `advisor/008-tenant-scope-gateway-memory-state` (f893885), revisado; gate na integração |
| 009 | Escrita de membro na memória da equipe vai para aprovação | P1 | S | — | DONE — `advisor/009-member-agent-memory-requires-approval` (c86724f), revisado; gate na integração |
| 010 | Escrita pendente de memória pessoal volta para o dono | P2 | M | 009 (merge) | DONE — `advisor/010-pending-write-owner` (aef851d), revisado; gate + contract:check na integração |
| 011 | Hook de fronteira do gateway roda de verdade | P2 | S | — | DONE — `advisor/011-fix-gateway-boundary-hook` (770809d), revisado |
| 012 | Advisories críticos/altos de produção | P1 | S–M | 016 | DONE — `4d2d5ef`; npm ls/dry-run válidos, audit 0 critical/high, 31 testes; gate na candidata |
| 013 | Piso de cobertura real + testes do `handleChatCore` | P2 | M | candidata 015; 002 excluído | DONE — `cdf47db` (caracterização, chatCore 0%→64%) + `c41bee8` (pisos: 31,1/25,3/31,6/32,4) |
| 014 | README real e PRODUCT.md atualizado | P3 | S | — | DONE — `advisor/014-readme-and-product-docs` (8eaea7e), revisado |
| 015 | Montar e validar a candidata isolada para produção | P1 | M | 001, 003–012, 014; incorpora 013 | DONE — `advisor/integration` em `c41bee8`; `npm run check` verde em 2026-11-02, audit 0 critical/high, npm 10 dry-run ok |
| 016 | Alinhar o seletor Better Call às versões requeridas e instaladas | P1 | S | parcial de 012 | DONE — incluído em `4d2d5ef`; seletor 1.4.x, npm 10/11 sem invalid/missing |

| 017 | Perfil da API key num botão (abas Recursos/Skills) | P2 | S | — | DONE — `bf014f1` na candidata; tradutor de runtime fazia "Skills" virar "Habilidades" |

Status: TODO | IN PROGRESS | DONE | BLOCKED (motivo) | REJECTED (motivo)

Retomada em 2026-11-01: a sessão Claude `a220b7fb-c49e-4f83-b8e7-ab06dc496b2a` parou por erro de API,
com 001/003/012 em execução. A solicitação anterior era terminar as revisões e preparar para produção.
`main` continua em `98d2947`. DONE acima significa revisão na branch isolada, não integração/deploy.
As alterações locais de provedores/sidebar pertencem a outra sessão e não entram na candidata.

## Notas de dependência

- 009 e 010 alteram `src/server/harness/memory/applyMemoryWrite.ts` (pontos diferentes): merge 009 primeiro,
  rebase 010.
- 013 sobe o piso de cobertura; fazer o merge por último para medir já com os testes dos outros planos.
- 012 mexe no lockfile: se outro plano também mexer (nenhum deveria), rebase e repetir a receita do npm 10.

## Achados considerados e rejeitados (não re-auditar)

- Comparação do CLI token sem tempo constante (`dashboardGuard.ts:17-21`): canal de tempo sobre rede, exploração prática baixa.
- Atalho de arquivo com extensão no `dashboardGuard.ts:78-82`: confiança baixa; precisa de investigação antes de plano.
- Prefixos IPv6 NAT64/6to4/Teredo no `ssrfGuard.ts`: dependente de rede; investigar.
- Listener de abort do hedge acumulando por conta (`chatCore.ts:317`): menor, vive só pela requisição.
- Escrita de skill tenant-wide por membro (`/api/harness/skills/agent`): depende do Jev configurado; follow-up do 009.
- Registry de executor de plugin global ao processo (`plugin-core/context.ts`): mecanismo real, mas só um executor montável hoje.
- Watchers de run contados por organização e não por membro; corpos sem limite de tamanho nas rotas do harness: válidos, prioridade menor.
- `getUsageStats("all")` recalculado por stream a cada request (`api/usage/stream`): real, esforço M; próximo ciclo.
- Remoção de `MetaBreak.pdf` (5 MB) e do crate `demo/`; ligar `knip` no CI; faixa de integração com Postgres real: decisões do dono.
- Arquivos acima de 600 linhas: a regra de `CONVENTIONS.md` está respeitada (só `components/ui/sidebar.tsx`, do shadcn).
