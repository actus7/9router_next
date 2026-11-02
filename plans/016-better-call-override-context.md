# Plan 016: O seletor do override reconhece o Better Call instalado

P1 · S · LOW · planejado em `98d2947`, 2026-11-01. Desbloqueia 012/015.

O 012 interrompeu corretamente após duas revisões. Sua árvore própria instalada tem Better Auth 1.7.12,
Better Call 1.4.4 e a cópia Davey 2.0.2 preservada; audit sem critical/high, 31 testes passando e dry-run válido.
Mesmo assim `npm ls better-call --all --json` retorna ELSPROBLEMS, marcando 1.4.4 inválido apesar de
requerer 1.4.4 e indicando `overridden: false`. O seletor atual é `"better-call@1.4.0": "1.4.4"`:
ele reconhece o pedido antigo mas não a versão instalada/peers 1.4.4. Testar um seletor 1.4.x coerente.

Executor separado, somente no worktree existente
`E:/projetos/routerx2/9router-new/.claude/worktrees/agent-ac8cd27217eddaaec`, branch
`advisor/012-npm-audit-prod-deps`. Há dois arquivos modificados do 012, sem commit; são parte desta entrega.
Preservar `main`, provedores/sidebar, transcrição e demais worktrees. Prefixar comandos com RTK.

Escopo: somente `package.json` e `package-lock.json`. Nenhuma mudança de versão adicional, fonte,
instalação, downgrade de major, flag force/legacy-peer-deps, build, migração ou deploy.
Dependências reais estão instaladas neste worktree, sem junction para main. Não alterar `node_modules`.

1. Conferir o estado e ler overrides/lock. Trocar apenas a chave do seletor por
   `"better-call@1.4.x": "1.4.4"`. O seletor deve cobrir o pedido 1.4.0 e os peers/instalação 1.4.4,
   preservando o 2.0.2 requerido por Davey. Não alterar versões ou outros overrides.
2. `rtk proxy npm ls better-call better-auth zod --all` deve terminar 0, sem invalid/missing.
   `rtk proxy npx -y npm@10.9.2 ls better-call --all` também deve terminar 0.
3. `rtk proxy npx -y npm@10.9.2 ci --dry-run --include=optional --ignore-scripts` deve terminar 0.
   Confirmar que nenhuma entrada/versão mudou por efeito do comando, em especial os três pacotes Prisma
   preservados no 012. `rtk proxy npm audit --omit=dev --json`: critical/high iguais a zero; low separado.
4. Rodar os três testes auth/cookies/routes já escolhidos no 012 e `git diff --check`; todos devem passar.
   Conferir o diff semântico completo contra `98d2947`, limitado às subárvores autorizadas no 012.
5. Se passar, commit dos dois arquivos que completam 012+016; mensagem pt-BR convencional. Sem push.
   Entregar SHA, resultado de cada comando, versões e confirmação de que a árvore instalada está estável.

STOP: seletor 1.4.x não elimina a falha, aparece alteração de versão, precisa reinstalar/forçar peers ou
tocar outra fonte. Não tentar outro conjunto de overrides sem nova análise. O advisor atualiza o índice.
