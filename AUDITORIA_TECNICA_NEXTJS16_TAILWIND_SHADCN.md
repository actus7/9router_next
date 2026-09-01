# Auditoria tecnica completa - Next.js 16, Tailwind CSS 4, shadcn/ui e qualidade arquitetural

**Projeto:** ModelHub / RouterX2 (`9router-new`)  
**Data:** 2026-09-01  
**Branch / commit-base:** `main` / `0f15b1f52ee1a615404954a5dfe3fd033d348a38`  
**Escopo:** codigo-fonte, configuracao, arquitetura, camada de dados, App Router, componentes, acessibilidade estatica, seguranca relacionada ao codigo, testes e gates de release.  
**Tipo de auditoria:** leitura e diagnostico; nenhum problema foi corrigido neste trabalho.

> **Nota sobre o worktree:** havia alteracoes locais antes da auditoria e uma refatoracao paralela continuou modificando dezenas de arquivos durante a coleta. O primeiro `lint`, `typecheck` e teste completo passaram; na ultima verificacao, quatro executores e um componente compartilhado em edicao tinham erros de parsing. O relatorio separa os problemas persistentes do projeto dos bloqueios do WIP atual. O unico arquivo criado por esta auditoria e este relatorio.

## Reauditoria de remediacao - checkpoint de decomposicao

**Veredito atualizado: NO-GO condicionado, sem bloqueador P0 funcional conhecido.** O snapshot original abaixo permanece preservado como evidencia histórica. A remediacao removeu XSS por Markdown, restaurou o contrato Prisma reproduzivel, corrigiu error boundaries, implementou fetch SSRF-safe com DNS/redirect pinning, propagou erros tipados de persistencia, ativou `exhaustive-deps` e `no-unused-vars`, eliminou imports diretos de repositorios nos Route Handlers e consolidou lifecycle/imagens/primitives shadcn.

Gates confirmados no checkpoint acumulado:

- Next.js 16.3.2 build passa; startup do layout foi movido para `instrumentation.register()` com guards de build e HMR.
- Lint e TypeScript passam com `exhaustive-deps` e unused como erro.
- 33 suites e 214 testes passam; cobertura esta em 4,42% statements, 2,55% branches, 3,82% functions e 4,79% lines, sem regressao da baseline e com 80% nos modulos criticos.
- `contract:check`, arquitetura dos handlers, build, `git diff --check` e `npm audit --omit=dev` passam; dependencias de producao reportam zero vulnerabilidades conhecidas.
- O detector Impeccable retornou `[]` nas superficies alteradas; axe cobre associacao de campos e confirmacao destrutiva.
- Todos os modulos tecnicos foram decompostos para menos de 600 linhas. O gate agora aceita apenas `globals.css` (fronteira global de tokens) e `components/ui/sidebar.tsx` (primitive oficial shadcn); artefatos Prisma gerados continuam excluidos.

Pendencias que impedem alterar o veredito para GO:

1. Concluir a consolidacao de cores funcionais cruas que nao representem marca/dados.
2. Corrigir os tres assets de logo ausentes observados no dashboard (`/providers/quillbot.png`, `/providers/duckai.png` e `/providers/ovh.png`); sao 404s visuais, nao uma falha de fluxo.

O uso de `space-y-*` foi removido de TS/TSX e substituido por `flex flex-col gap-*`, preservando o espacamento com layout explicito. A decomposicao incluiu analytics de uso, testes OAuth de provedores, proxies OAuth locais, instalacao/Funnel Tailscale, codecs Cursor, stream ACP Devin, Duck.ai e Kiro EventStream.

Verificacao autenticada local concluida em browser real: login, dashboard, Chat, configuracoes de Chat, desktop/mobile e claro/escuro. O dashboard manteve navegacao e nomes acessiveis; em Chat sem provedores configurados, provider/model e envio ficaram corretamente indisponiveis. Os tres 404s de logo acima foram os unicos erros de console observados nessa passagem.

## Veredito executivo

**NO-GO para release no estado atual.**

O projeto usa as tecnologias corretas e tem uma fundacao melhor do que a media: Next.js 16.3.2 com App Router, React 19.2.8, Tailwind CSS 4 CSS-first, shadcn/ui `base-nova` sobre Base UI, TypeScript estrito, limites do gateway documentados e alguns controles de seguranca bem testados. O problema nao e a escolha da stack; e a distancia entre as convencoes declaradas e o codigo efetivamente protegido pelos gates.

Os bloqueadores principais sao:

1. **XSS reproduzivel no chat:** Markdown nao confiavel vindo dos modelos e injetado como HTML sem sanitizacao.
2. **Worktree atual nao compila:** a ultima verificacao encontrou erros sintaticos em quatro executores e um componente compartilhado em refatoracao; lint/typecheck falham e tres suites ja haviam falhado no snapshot imediatamente anterior.
3. **Contrato Prisma 8 sem fonte:** `prisma.config.ts` aponta para um `contract.prisma` inexistente e `npm run contract:emit` falha.
4. **Cobertura global de apenas 4,44% das linhas:** 186 testes verdes no snapshot inicial cobrem uma fracao muito pequena das 160 rotas e do gateway.
5. **Regras de hooks e codigo morto desligadas:** uma execucao estrita encontrou 44 violacoes reais de dependencias de hooks e 523 ocorrencias de codigo/imports nao usados, desconsiderando o erro transitorio de parsing daquele snapshot.

### Contagem de achados

| Severidade | Quantidade | Significado |
|---|---:|---|
| P0 - bloqueador | 2 | risco de seguranca exploravel ou impossibilidade de gerar release no worktree atual |
| P1 - maior | 8 | falha relevante de runtime, arquitetura, acessibilidade ou garantia de qualidade |
| P2 - menor | 9 | divida sistemica, manutencao, desempenho ou inconsistencia de design system |
| P3 - cosmetico | 2 | documentacao/assinatura visual sem impacto funcional imediato |
| **Total** | **21** | |

## Placar de saude da interface

Escala do `impeccable audit`: 0 = critico, 4 = excelente.

| # | Dimensao | Nota | Evidencia principal |
|---|---|---:|---|
| 1 | Acessibilidade | 2/4 | wrapper `Input` nao associa `Label` ao controle; alvos de toque abaixo de 44 px |
| 2 | Performance | 2/4 | `Suspense` sem efeito apos `await`, side effects no root layout, politica de imagem ampla |
| 3 | Responsividade | 2/4 | uso consistente de breakpoints, mas controles de 36 px e botoes iconicos menores |
| 4 | Theming | 2/4 | tokens OKLCH e dark mode existem, mas ha 837 usos de paleta Tailwind crua e 246 overrides `dark:` |
| 5 | Integridade de implementacao | 2/4 | produto e coerente, mas ha um design system paralelo e desvios shadcn sistemicos |
| **Total** |  | **10/20 - aceitavel, com trabalho significativo** | |

### Veredito de integridade de implementacao

**PASSA COM GRANDES RESSALVAS.** A interface e inequivocamente especifica do produto (provedores, combos, quota, topologia, CLI tools) e possui tokens e componentes compartilhados. Entretanto, o sistema oficial shadcn e encapsulado por uma segunda biblioteca (`src/shared/components/Button.tsx`, `Input.tsx`, `Card.tsx`, `Modal.tsx`, `Select.tsx`) que reintroduz APIs, estilos e comportamentos divergentes. Isso aumenta o custo de manutencao e torna as regras do shadcn nao verificaveis por composicao.

## Matriz de aderencia solicitada

| Area | Estado | Qualificacao |
|---|---|---|
| Next.js 16+ | Parcial | App Router, RSC, metadata, `next/font` e convencoes de arquivos estao presentes; error boundaries usam API anterior ao 16.3 e startup tem imports com side effect no layout |
| Tailwind CSS 4 | Parcial | CSS-first e `@theme inline` corretos; arquivo global monolitico e grande quantidade de cores/utilitarios fora dos tokens |
| shadcn/ui | Parcial | `base-nova`, Base UI, aliases e primitives corretos; wrappers paralelos, forms sem `Field`, `Dialog` para confirmacao destrutiva e overrides de estilo |
| Clean Architecture | Parcial | boundaries documentados e parte deles protegida por ESLint/testes; 44 rotas acessam repos diretamente e rotas de ate 705 linhas concentram dominio |
| Clean Code | Insuficiente | 19 arquivos acima de 600 linhas, 523 itens nao usados no snapshot estrito, erros convertidos em estados vazios |
| DRY | Insuficiente | logica duplicada em cards de CLI e estilos/status repetidos em dezenas de componentes |
| KISS | Parcial | feature folders e hooks melhoraram telas grandes; adaptadores paralelos, fallbacks silenciosos e rotas monoliticas aumentam complexidade |
| SOLID | Parcial/insuficiente | seams do engine ajudam DIP; SRP e ISP sao violados por executores, repositorios e Route Handlers extensos |
| Testabilidade/release | Insuficiente | testes unitarios rapidos, mas cobertura 4,44%, sem thresholds, contrato Prisma quebrado e worktree final sem parsing |

## Gates executados

| Gate | Resultado | Observacao |
|---|---|---|
| `npm run lint` - snapshot inicial | PASS | configuracao atual nao acusa regras desabilitadas |
| `npm run typecheck` - snapshot inicial | PASS | executado antes da refatoracao paralela introduzir erros sintaticos |
| `npm run test` - snapshot inicial | PASS | 27 arquivos, 186/186 testes |
| `npm run build` - durante WIP | FAIL | compilacao do bundle terminou, mas a checagem TS pegou JSX em `sidebarData.ts`; o WIP depois renomeou o arquivo |
| `npm run lint` - repeticao final | FAIL | parsing em `codex.ts`, `cursor.ts`, `github.ts` e `windsurf.ts`; a refatoracao continuou depois desta execucao |
| `npm run typecheck` - ultima verificacao | FAIL | erros sintaticos nos quatro executores acima e em `KiroAuthModalSections.tsx` |
| `npm run test` - repeticao final | FAIL | 24 suites passam; 3 suites de plugin-core nao transformam `github.ts`; 178 testes executados passam |
| `npm run test -- --coverage` | PASS com ressalva | statements 4,12%; branches 2,26%; functions 3,48%; lines 4,44% |
| `npm audit --omit=dev` | PASS | 0 vulnerabilidades conhecidas nas dependencias de producao |
| `npm run contract:emit` | FAIL | `CONTRACT.SOURCE_LOAD_FAILED`; `src/prisma/contract.prisma` nao existe |
| detector Impeccable | 4 avisos | 3 assinaturas visuais e 1 advisory; nenhum substitui os achados funcionais abaixo |
| `git diff --check` | PASS no momento da coleta | sem whitespace errors nas alteracoes rastreadas daquele snapshot |

## Achados detalhados

### P0 - bloqueadores

#### P0-01 - XSS por Markdown de resposta do modelo sem sanitizacao

- **Local:** `src/app/(dashboard)/dashboard/basic-chat/chatFormatUtils.ts:12-15`; `src/app/(dashboard)/dashboard/basic-chat/sections/ChatMessageList.tsx:137-140`.
- **Categoria:** seguranca / integridade de implementacao.
- **Evidencia:** `marked.parse(text)` e retornado diretamente e inserido com `dangerouslySetInnerHTML`. Nao ha `DOMPurify`, allowlist de elementos ou renderer que escape HTML. `npm ls dompurify --depth=0` retornou vazio.
- **Reproducao minima:** `marked.parse('<img src=x onerror=alert(1)>')` retornou literalmente `<img src=x onerror=alert(1)>`.
- **Impacto:** um provedor/modelo malicioso, prompt injection ou conteudo armazenado pode executar HTML/event handlers no contexto autenticado do dashboard, ler dados acessiveis no browser e acionar APIs administrativas.
- **Padrao:** CWE-79; OWASP A03 Injection.
- **Recomendacao:** sanitizar depois do parse com uma biblioteca mantida e configurada por allowlist, ou renderizar Markdown como arvore React sem HTML cru. Bloquear HTML inline e URLs perigosas; adicionar testes com `onerror`, SVG, `javascript:` e HTML quebrado. Adicionar CSP como defesa em profundidade, sem tratar CSP como substituto da sanitizacao.
- **Comando Impeccable sugerido:** `$impeccable harden`.

#### P0-02 - Estado atual do worktree nao passa parsing/typecheck/testes

- **Local:** `src/server/llm-gateway/engine/executors/codex.ts:406`; `cursor.ts:558`; `github.ts:256`; `windsurf.ts:437`; `src/shared/components/KiroAuthModalSections.tsx:40`.
- **Categoria:** release / clean code.
- **Evidencia:** a ultima execucao de `tsc --noEmit` falhou com dezenas de erros sintaticos nos cinco arquivos; a execucao anterior de ESLint ja acusava parsing nos quatro executores e tres suites `pluginCore*` falharam ao transformar `github.ts`.
- **Impacto:** nao e possivel afirmar que o estado atual compila ou gerar release confiavel.
- **Contexto importante:** estes erros surgiram durante uma refatoracao paralela ativa; o snapshot inicial passava lint, typecheck e 186 testes. Ainda assim, no estado final coletado, sao bloqueadores existentes.
- **Recomendacao:** concluir ou isolar o WIP, restaurar parsing, repetir `npm run check` e so entao avaliar regressao funcional. Nao mascarar os arquivos com ignores.

### P1 - problemas maiores

#### P1-01 - Fonte do contrato Prisma 8 ausente

- **Local:** `prisma.config.ts:5-10`; diretorio `src/prisma/` contem apenas `contract.json` e `contract.d.ts`.
- **Categoria:** camada de dados / build / source of truth.
- **Evidencia:** `contract` aponta para `./src/prisma/contract.prisma`; `npm run contract:emit` falha com `CONTRACT.SOURCE_LOAD_FAILED` e `PSL_SCHEMA_READ_FAILED`/`ENOENT`.
- **Impacto:** os artefatos gerados nao podem ser reproduzidos, auditados ou evoluidos a partir da fonte; onboarding, CI e futuras migrations ficam quebrados.
- **Padrao:** Prisma 8 contract-first exige `contract.prisma` ou `contract.ts` como fonte e trata JSON/d.ts como artefatos emitidos.
- **Recomendacao:** restaurar a fonte correspondente aos artefatos ou remover integralmente a integracao Prisma se ela for obsoleta. Depois, emitir o contrato em CI e verificar diff dos artefatos.

#### P1-02 - Error boundaries usam a prop antiga no Next.js 16.3

- **Local:** `src/app/global-error.tsx:5-20`; `src/app/(dashboard)/error.tsx:7-29`.
- **Categoria:** Next.js 16 / resiliencia.
- **Evidencia:** ambos esperam `reset`; a documentacao local instalada do Next.js 16.3.2 define `retry` como prop estavel desde 16.3.0 e recomenda `retry()` para refetch/re-render. `reset()` tem semantica diferente e nao e a prop principal recebida nesses exemplos atuais.
- **Impacto:** justamente no caminho de falha, o botao "Try again" pode receber funcao indefinida ou nao executar a recuperacao esperada.
- **Recomendacao:** alinhar os dois boundaries ao contrato 16.3.2 (`retry`), manter `error` para observabilidade e adicionar teste de componente/fluxo de recuperacao.
- **Comando Impeccable sugerido:** `$impeccable harden`.

#### P1-03 - Cobertura de testes incompatível com o tamanho e risco do projeto

- **Local:** `vitest.config.ts:4-17`; 160 Route Handlers e 1.327 arquivos TS/TSX no snapshot de inventario.
- **Categoria:** testabilidade / release.
- **Evidencia:** 4,12% statements, 2,26% branches, 3,48% functions e 4,44% lines. Nao ha `thresholds` na configuracao. `passWithNoTests: true` reduz ainda mais a forca do gate.
- **Impacto:** testes verdes nao protegem a maior parte dos providers, transformadores, rotas, persistencia e UI; refatoracoes amplas podem regredir silenciosamente.
- **Recomendacao:** definir baseline realista e crescente por camada, com thresholds mais altos para codigo novo/alterado. Priorizar auth, SSRF, protocol translators, migrations, error boundaries e rotas administrativas. Separar testes unitarios, contratos e integracao.

#### P1-04 - `exhaustive-deps` globalmente desligado esconde defeitos reais

- **Local:** `eslint.config.mjs:8-20` e, entre outros, `useSessionPersistence.ts:72-210`, `EndpointPageClient.tsx:35-95`, `ProviderTopology.tsx:420-458`.
- **Categoria:** React / clean code / confiabilidade.
- **Evidencia:** a execucao com `react-hooks/exhaustive-deps:error` encontrou 44 problemas de hooks no snapshot valido, excluindo o erro transitorio de parsing. Ha dependencias ausentes em efeitos/callbacks que sincronizam chat, sessao, endpoint, quotas e provedores.
- **Impacto:** closures obsoletas, efeitos que nao reagem a mudancas, sincronizacao duplicada e bugs dependentes de ordem/tempo.
- **Recomendacao:** reativar a regra por etapas. Corrigir por dominio; nao adicionar dependencias mecanicamente quando a solucao correta for estabilizar callbacks, reduzir o efeito ou mover a operacao para evento/derivacao.

#### P1-05 - Guard SSRF nao cobre DNS nem redirects

- **Local:** `src/shared/utils/ssrfGuard.ts:3-63`; usos em `application/fetch.ts:74-84`, `provider-nodes/validate/route.ts:68-78` e `search/callers.ts:59-77`.
- **Categoria:** seguranca / rede.
- **Evidencia:** o guard bloqueia apenas hostnames literais, sufixos e IPs literais privados. Nao resolve A/AAAA antes da conexao, nao fixa o endereco validado e os `fetch` seguem redirects por padrao sem revalidar cada destino.
- **Impacto:** dominio controlado pelo atacante pode resolver para loopback/rede privada ou redirecionar para metadata/servico interno, contornando a validacao textual.
- **Recomendacao:** resolver DNS e validar todos os enderecos, conectar ao IP validado preservando Host/SNI quando aplicavel, revalidar cada redirect com limite baixo e considerar bloqueio de ranges reservados adicionais. Adicionar testes de DNS rebinding e redirect para IP privado.

#### P1-06 - Falhas de banco sao convertidas em listas vazias/null

- **Local:** `src/lib/data-access.ts:82-151`, `193-211`, `238-289`, `333-365`, `435-462`.
- **Categoria:** error handling / clean architecture.
- **Evidencia:** pelo menos 13 caminhos capturam excecoes e retornam `[]`/`null`; por exemplo, erro em `getProviderConnections()` aparece para a pagina como "nenhum provider".
- **Impacto:** indisponibilidade/corrupcao pode ser apresentada como ausencia legitima de dados. Isso prejudica diagnostico e pode induzir o usuario a recriar ou apagar configuracoes.
- **Padrao Next.js 16:** erros inesperados devem propagar para o error boundary/observabilidade; estados esperados devem ser modelados explicitamente.
- **Recomendacao:** usar resultados discriminados apenas para falhas esperadas e propagar excecoes inesperadas. Diferenciar `not_found`, `empty`, `unavailable` e `corrupt`; registrar com contexto sem duplicar logs em todas as camadas.

#### P1-07 - Route Handlers concentram dominio e acesso direto a repositorios

- **Local:** `src/app/api/providers/[id]/models/route.ts` (705 linhas), `api/v1/models/route.ts` (675), `api/v1beta/models/[...path]/route.ts` (594), `api/providers/validate/route.ts` (574).
- **Categoria:** Clean Architecture / SRP / DIP.
- **Evidencia:** 16 Route Handlers excedem 200 linhas; 44 importam `@/lib/db/repos` diretamente. Ha parsing de protocolos, refresh OAuth, discovery, fetch upstream, deduplicacao e regras de provider dentro de `route.ts`.
- **Impacto:** HTTP, dominio e infraestrutura ficam acoplados; a mesma regra tende a ser duplicada entre rotas e o teste exige contexto maior.
- **Violacao interna:** `docs/ARCHITECTURE.md` diz que `src/app/api` deve apenas validar, delegar e serializar.
- **Recomendacao:** extrair use cases por feature para `src/server/.../application`; manter Route Handlers finos e tipados. Repositorios devem ficar atras da camada de aplicacao, exceto adaptadores explicitamente documentados.

#### P1-08 - Labels do wrapper `Input` nao estao associados ao input

- **Local:** `src/shared/components/Input.tsx:27-66`.
- **Categoria:** acessibilidade / shadcn forms.
- **Evidencia:** `<Label>` nao recebe `htmlFor`, o input nao recebe um id gerado e os dois nao estao aninhados. A mensagem de erro tambem nao possui id ligado por `aria-describedby`.
- **Impacto:** leitores de tela podem anunciar o controle sem nome/descricao; clicar no label nao transfere foco; erro visual nao e necessariamente anunciado.
- **Padrao:** WCAG 1.3.1, 3.3.2 e 4.1.2; regras shadcn `FieldGroup` + `Field`, `data-invalid` e `aria-invalid`.
- **Recomendacao:** migrar forms para `Field`/`FieldLabel`/`FieldDescription`, gerar id estavel, conectar label e mensagens, e testar com axe/Testing Library.
- **Comando Impeccable sugerido:** `$impeccable harden`.

### P2 - problemas menores/sistemicos

#### P2-01 - Design system paralelo ao shadcn

- **Local:** `src/shared/components/Button.tsx`, `Input.tsx`, `Select.tsx`, `Card.tsx`, `Modal.tsx`; 60 imports diretos do Button compartilhado.
- **Evidencia:** wrappers mapeiam uma API propria para shadcn, sobrescrevem cores/tipografia, dimensionam icones manualmente e adicionam `loading`. `ConfirmModal` usa `Dialog` em vez de `AlertDialog` para operacoes destrutivas.
- **Impacto:** duas fontes de verdade, maior superficie de regressao, documentacao oficial menos aplicavel e inconsistencias de acessibilidade/tema.
- **Recomendacao:** escolher uma camada canonica. Preferencialmente usar primitives shadcn diretamente e criar apenas componentes de dominio compostos. Migrar confirmacoes destrutivas para `AlertDialog`; loading deve compor `Spinner`, `disabled` e `data-icon`.
- **Comando Impeccable sugerido:** `$impeccable document` antes da migracao e `$impeccable harden` durante a migracao.

#### P2-02 - Drift de Tailwind/theming em escala

- **Local:** `src/app/globals.css` (969 linhas) e componentes de landing/dashboard.
- **Evidencia:** 837 ocorrencias de classes com paleta crua, 246 overrides `dark:` de cor e 52 usos `space-x/y` em `src/app`/`src/shared`. Exemplos repetidos de status verde/amarelo/azul aparecem em CLI cards, providers e endpoint.
- **Impacto:** accent presets e futuros temas nao retintam toda a aplicacao; contraste e estado variam entre telas; mudancas exigem busca global.
- **Recomendacao:** criar tokens/variants semanticos de `success`, `warning`, `info` e estados de conexao; reutilizar `Badge`/`Alert`; usar `gap-*`; reduzir CSS global a tokens/base e estilos realmente globais.
- **Comando Impeccable sugerido:** `$impeccable colorize` e depois `$impeccable polish`.

#### P2-03 - Codigo morto nao faz parte do gate

- **Local:** `eslint.config.mjs:16-21`.
- **Evidencia:** `@typescript-eslint/no-unused-vars` esta desligado. A execucao estrita encontrou 523 ocorrencias validas no snapshot, excluindo o parsing transitorio: imports, constantes, funcoes e props nao usados.
- **Impacto:** bundle/analise mais ruidosos, caminhos obsoletos confundem manutencao e refatoracoes parecem mais arriscadas.
- **Recomendacao:** ativar como warning, limpar por feature e elevar para error em codigo novo/alterado. Configurar excecoes deliberadas para argumentos `_` e contratos publicos.

#### P2-04 - Arquivos grandes violam SRP e a convencao local

- **Local:** 19 arquivos acima de 600 linhas fora de gerados/UI; `kiro.ts` 1.403, `duckai.ts` 1.316, `cursor.ts` 1.172, `usageRepo.ts` 952, `cursorProtobuf.ts` 908.
- **Impacto:** alta carga cognitiva, merge conflicts, testes pouco focados e mudancas com blast radius maior.
- **Recomendacao:** decompor por protocolo/fase/use case; separar types, parse/serialize, auth, transport e retries. Nao dividir apenas por contagem: cada modulo deve ter uma razao clara para mudar.

#### P2-05 - `Suspense` colocado depois do `await` nao mostra o fallback

- **Local:** `providers/page.tsx:12-28`, `profile/page.tsx:6-14`, `combos/page.tsx`, `media-providers/[kind]/page.tsx`, `media-providers/web/page.tsx`.
- **Evidencia:** dados sao aguardados antes de criar o boundary; o componente filho recebe dados ja resolvidos. O fallback nao cobre a espera principal.
- **Impacto:** falsa sensacao de streaming e pior feedback em operacoes lentas.
- **Recomendacao:** mover o `await` para um Server Component filho dentro do `Suspense` ou usar `loading.tsx` no segmento. Remover boundaries que envolvem apenas Client Components que nunca suspendem.
- **Comando Impeccable sugerido:** `$impeccable optimize`.

#### P2-06 - Startup por import com side effect no root layout

- **Local:** `src/app/layout.tsx:9-16`; `src/shared/services/bootstrap.ts:1-17`; `src/instrumentation.ts:1-14`.
- **Evidencia:** o layout importa `initOutboundProxy` e `bootstrap` por side effect e chama `initConsoleLogCapture()` no escopo do modulo, embora `instrumentation.register()` ja inicialize a captura. A documentacao local recomenda importar side effects dentro de `register()`.
- **Impacto:** inicializacao depende de avaliacao de modulo/layout, pode duplicar em workers/build/HMR e mistura lifecycle do servidor com renderizacao.
- **Recomendacao:** centralizar startup Node em `instrumentation.register()`, com guards explicitos e estrategia documentada para schedulers em replicas/serverless. Remover a inicializacao duplicada do layout.

#### P2-07 - Politica de imagens e lint excessivamente amplos

- **Local:** `next.config.ts:23-28`; `eslint.config.mjs:23-27`; nove `<img>` crus no codigo.
- **Evidencia:** `remotePatterns` aceita qualquer hostname HTTPS e `@next/next/no-img-element` esta desligado globalmente. Alguns casos de data/blob URL sao legitimos, mas a excecao vale para todo o repo.
- **Impacto:** novos usos nao otimizados entram sem alerta; o optimizer pode buscar hosts arbitrarios quando `Image` recebe URL remota permitida.
- **Recomendacao:** restringir hosts conhecidos, usar `unoptimized`/`<img>` apenas em wrappers documentados para data/blob/dynamic media e manter a regra ativa no restante.
- **Comando Impeccable sugerido:** `$impeccable optimize`.

#### P2-08 - Alvos de toque abaixo de 44x44 px

- **Local:** `AccentColorPicker.tsx:63-82` (`size-9`), `ChatComposer.tsx:27-32` (botao apenas com icone `size-3.5` sem area minima), `ChatMobileHistoryMenu.tsx:43` (`py-2`).
- **Categoria:** acessibilidade / responsividade.
- **Impacto:** maior taxa de erro em mobile e para pessoas com limitacao motora.
- **Padrao:** WCAG 2.5.8 (Target Size Minimum, AA; com excecoes contextuais) e boa pratica mobile de 44 px.
- **Recomendacao:** garantir `min-size-11`/area clicavel equivalente em acoes primarias/iconicas e manter espacamento visual independente da hit area.
- **Comando Impeccable sugerido:** `$impeccable adapt`.

#### P2-09 - Duplicacao em cards de CLI apesar de hook compartilhado existente

- **Local:** `ClineToolCard.tsx`, `CodexToolCard.tsx`, `DeepSeekTuiToolCard.tsx`, `DroidToolCard.tsx`, `HermesToolCard.tsx`, `JcodeToolCard.tsx`, `KiloToolCard.tsx`, `OpenClawToolCard.tsx`; `useCliToolCommon.ts`.
- **Evidencia:** os componentes repetem `fetchModelAliases`, estados, mensagens e tratamentos de erro; outros cards ja usam `useModelAliases()`.
- **Impacto:** correcoes de loading/error/cache precisam ser replicadas e ja divergem entre ferramentas.
- **Recomendacao:** extrair um controller/hook configuravel e manter cards como composicao de secoes especificas. Evitar um "mega-card" cheio de booleanos; preferir capacidades declarativas por ferramenta.

### P3 - cosmeticos/documentais

#### P3-01 - Ausencia de `PRODUCT.md` e `DESIGN.md`

- **Categoria:** governanca de produto/design.
- **Impacto:** tokens existentes sao a unica autoridade visual; decisoes de identidade, modos de uso e excecoes intencionais nao ficam explicadas.
- **Recomendacao:** documentar produto e sistema visual atual sem redesenhar, incluindo quais areas (landing vs dashboard) podem ter linguagens distintas.
- **Comando Impeccable sugerido:** `$impeccable init` em outro turno e depois `$impeccable document`.

#### P3-02 - Assinaturas visuais detectadas, com falsos positivos parciais

- **Local:** `EndpointCard.tsx:269`; `globals.css:641` e `839`.
- **Evidencia:** detector marcou gradiente indigo, grid decorativo e borda lateral. O grid da landing/topologia e parcialmente justificavel pelo dominio; a borda em blockquote e semantica de citacao, portanto nao deve ser tratada automaticamente como defeito.
- **Impacto:** baixo; risco de visual generico apenas no gradiente/status isolado.
- **Recomendacao:** revisar o gradiente do endpoint no contexto do design system; manter grid/borda quando tiverem funcao clara. Nao fazer reescrita mecanica baseada no detector.
- **Comando Impeccable sugerido:** `$impeccable critique` e, ao final, `$impeccable polish`.

## Padroes sistemicos

1. **Gates verdes por configuracao permissiva:** lint/typecheck passam enquanto regras de hooks, imutabilidade e unused estao desativadas.
2. **Fallback silencioso em vez de erro tipado:** banco, UI hooks e APIs frequentemente fazem `console.error` e retornam valor neutro.
3. **Duplicacao entre providers/tools:** a extensibilidade existe por registros, mas implementacoes continuam copiando fetch, status, badges e parsing.
4. **Boundaries arquiteturais assimetricos:** o engine tem seams e regras fortes; `app/api` continua acessando repositorios e implementando dominio.
5. **Design tokens existem, mas sao opcionais:** a presenca de uma segunda camada de componentes permite ignorar variantes/tokens shadcn sem falhar no CI.
6. **Testes focados em contratos importantes, cobertura global ausente:** bons testes de host seam, catalogo e auth coexistem com grandes superficies nao exercitadas.

## Pontos positivos a preservar

- Stack atual e coerente: Next.js 16.3.2, React 19.2.8, Tailwind 4 e TypeScript strict.
- App Router organizado por features, com apenas tres `page.tsx` marcadas como Client Components; varias paginas buscam dados no servidor e passam payload serializavel para clientes.
- `next/font`, metadata tipada, `loading.tsx`, `not-found.tsx`, error boundaries e `instrumentation.ts` ja fazem parte da estrutura.
- Tailwind v4 corretamente CSS-first, sem `tailwind.config.js`, com tokens OKLCH, dark mode, accent presets e tratamento intencional de `prefers-reduced-motion`.
- shadcn configurado corretamente como `base-nova`, Base UI, RSC, Lucide e aliases `@/components/ui`/`@/lib/utils`.
- `Select` compartilhado usa `items` e `SelectGroup`, sinal de que a diferenca Base UI vs Radix foi compreendida em parte.
- Limites do gateway estao documentados e parcialmente aplicados por `no-restricted-imports` e `hostSeam.test.ts`.
- Guard de dashboard/API tem default seguro, sessao assinada, modo local restrito e testes contra spoofing de peer headers.
- Testes cobrem SSRF literal, mascaramento de segredos, pureza do catalogo, contratos de rotas e provider normalization.
- Headers `X-Frame-Options`, `nosniff`, `Referrer-Policy` e `Permissions-Policy` estao configurados; `poweredByHeader` esta desligado.
- `npm audit --omit=dev` nao encontrou vulnerabilidades conhecidas.
- A decomposicao recente de telas grandes em hooks/secoes segue `docs/CONVENTIONS.md`; apenas sete TSX de app/shared excediam 400 linhas no snapshot de inventario e nenhum excedia 600.

## Plano de remediacao recomendado

### Fase 0 - parar release

1. Sanitizar todo Markdown/HTML nao confiavel e adicionar testes XSS.
2. Concluir/isolar o WIP atual ate lint, typecheck, testes e build passarem no mesmo commit.
3. Restaurar/remover corretamente a fonte Prisma e tornar `contract:emit` reproduzivel.

### Fase 1 - confiabilidade e seguranca

1. Corrigir `retry` nos error boundaries Next 16.3.
2. Endurecer SSRF contra DNS/redirect.
3. Parar de transformar falha de banco em estado vazio.
4. Reativar `exhaustive-deps` por feature e tratar os 44 achados.
5. Criar thresholds de cobertura e testes de integracao para fluxos criticos.

### Fase 2 - arquitetura e clean code

1. Afinar os 16 maiores Route Handlers e retirar acesso direto a repositorios da camada HTTP.
2. Decompor os 19 arquivos acima de 600 linhas por responsabilidade.
3. Consolidar cards de CLI e services de status/fetch.
4. Reativar `no-unused-vars` gradualmente.

### Fase 3 - Tailwind/shadcn/UI

1. Definir a API canonica do design system e migrar os wrappers paralelos.
2. Adicionar `Field`, `FieldGroup`, `FieldDescription`, `AlertDialog`, `Empty`, `Spinner` e `InputGroup` conforme necessidade real.
3. Substituir cores/status repetidos por tokens e variants semanticos.
4. Corrigir hit areas, labels e descricoes; executar axe e verificacao visual desktop/mobile.
5. Corrigir `Suspense`, startup e politica de imagens.

### Ordem de comandos Impeccable

1. **P0/P1 - `$impeccable harden`**: XSS, error boundaries, forms, estados de erro e confirmacoes.
2. **P2 - `$impeccable document`**: registrar o sistema visual antes de consolidar wrappers/tokens.
3. **P2 - `$impeccable optimize`**: Suspense, imagens e lifecycle de startup relacionado a UI.
4. **P2 - `$impeccable adapt`**: hit areas e validacao responsive.
5. **P2 - `$impeccable colorize`**: substituir paletas cruas por semantica coerente.
6. **P3 - `$impeccable critique`**: avaliar apenas as assinaturas visuais contextuais.
7. **Final - `$impeccable polish`**: ultima passada depois de todos os gates e testes.

## Criterios de aceite para sair de NO-GO

- Payloads Markdown maliciosos nao geram elementos/atributos executaveis no DOM.
- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run contract:emit` e `npm run build` passam consecutivamente no mesmo HEAD/worktree limpo.
- Error boundaries usam a API da versao 16.3.2 e o botao de recuperacao e testado.
- SSRF revalida DNS e redirects; testes cobrem resolucao/redirect privado.
- Falha de persistencia aparece como erro indisponivel, nunca como lista vazia legitima.
- `exhaustive-deps` esta ativo nas features criticas sem suppressions genericas.
- Cobertura tem thresholds e tendencia crescente; codigo novo critico possui testes de branches.
- Route Handlers prioritarios apenas validam/delegam/serializam.
- Forms principais tem nome, descricao e erro programaticamente associados; alvos mobile atendem 44 px ou excecao justificada.
- Paletas de status usam tokens/variants e dark mode e validado visualmente.

---

Voce pode pedir para executar essas remediacoes uma por vez, todas em sequencia ou na ordem que preferir. Depois das correcoes, execute novamente `$impeccable audit` para medir a evolucao do placar.
