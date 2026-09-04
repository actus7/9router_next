# Auditoria do core: endpoint operacional + gerenciamento de modelos

**Status: concluída.** Trinta achados, trinta fechados. Ver "Estado final" no
fim deste documento.

Escopo: caminho de request do gateway (`/v1/*`, `/v1beta/*`), o subsistema de
catálogo e disponibilidade de modelos, e os fluxos de validação e teste de
provider e modelo. Não cobre dashboard, harness/basic-chat, cloud deploy,
tunnel nem media providers exceto onde tocam o caminho quente.

Duas rodadas: os grupos G1 a G8 e os achados 1 a 18 são da primeira, sobre o
core do endpoint; os achados V1 a V12 são da segunda, sobre validação e teste.

Baseline verificado na abertura da auditoria: `npm run typecheck` limpo,
`vitest run` com 647 testes passando, cobertura global travada em ~6%.

---

## Grupos de auditoria

### G1 — Borda HTTP e autenticação do endpoint

Onde o request entra e onde se decide se ele pode entrar.

| Arquivo | Papel |
| --- | --- |
| `src/proxy.ts` | Proxy (middleware) do Next, matcher global |
| `src/dashboardGuard.ts` | Guarda de borda: allowlist pública, local-only, sessão, API key |
| `next.config.ts` | Rewrites `/v1`, `/v1beta`, `/codex`, `/responses`; headers de segurança |
| `src/app/api/v1/**/route.ts` | Shims finos por endpoint |
| `src/server/llm-gateway/auth/accountSelection.ts` (`extractApiKey`, `isValidApiKey`) | Extração e validação do bearer |
| `src/lib/db/repos/apiKeysRepo.ts` | Persistência das API keys |
| `src/server/llm-gateway/application/{chat,embeddings,tts,stt,imageGeneration,videoGeneration,search,fetch}.ts` | Gate `requireApiKey` replicado em 8 arquivos |

Auditar: consistência do gate entre endpoints, cobertura da allowlist de borda
versus os rewrites, endpoints de metadados sem gate, armazenamento das keys.

### G2 — Admissão e roteamento do request

| Arquivo | Papel |
| --- | --- |
| `src/server/llm-gateway/application/chat.ts` | `handleChat`, `routeChatRequest`, `handleSingleModelChat` |
| `src/server/llm-gateway/application/modelResolution.ts` | Parse do model, alias, combo, provider nodes |
| `src/server/llm-gateway/engine/services/combo.ts` | Combos com retry entre modelos |
| `src/server/llm-gateway/engine/services/comboFusion.ts` | Estratégia fusion |
| `src/server/llm-gateway/engine/services/capacityAdapter.ts` | Adaptador por capacidade |
| `src/server/llm-gateway/engine/services/smart-routing/router.ts` | Smart routing |
| `src/server/llm-gateway/engine/utils/bypassHandler.ts` | Curto-circuito de probes |

Auditar: ordem de precedência das camadas, terminação dos loops, erros
propagados ao cliente, mapeamento de modelo desconhecido.

### G3 — Seleção de conta e fallback (coração operacional)

| Arquivo | Papel |
| --- | --- |
| `src/server/llm-gateway/auth/accountSelection.ts` | `getProviderCredentials`, `markAccountUnavailable`, `clearAccountError` |
| `src/server/llm-gateway/engine/services/accountFallback.ts` | `checkFallbackError`, backoff |
| `src/server/llm-gateway/engine/config/errorConfig.ts` | `ERROR_RULES`, cooldowns, backoff |
| `src/server/llm-gateway/application/noAuthCooldown.ts` | Cooldown por provider em memória |
| `src/server/llm-gateway/auth/tokenRefresh.ts` | Refresh reativo e persistência |
| `src/server/llm-gateway/auth/backgroundTokenRefresh.ts` | Refresh proativo agendado |
| `src/lib/db/repos/connectionsRepo.ts` | Conexões e credenciais |
| `src/lib/db/repos/modelAvailabilityRepo.ts` | Locks por (conexão, modelo) |

Auditar: classificação de erro, rotação entre contas, escopo dos cooldowns,
mutex de seleção, semântica de `testStatus`.

### G4 — Execução no provider

| Arquivo | Papel |
| --- | --- |
| `src/server/llm-gateway/engine/executors/index.ts` | Resolução do executor (plugin → estático → default) |
| `src/server/llm-gateway/engine/executors/base.ts` | Loop de base URLs, retry por status, connect timeout |
| `src/server/llm-gateway/engine/executors/default.ts` | Transporte genérico dirigido pelo registry |
| `src/server/llm-gateway/engine/utils/proxyFetch.ts` | Fetch com proxy/relay |
| `src/server/llm-gateway/engine/config/runtimeConfig.ts` | Timeouts e retry defaults |
| `src/server/llm-gateway/engine/handlers/chatCore/upstreamErrors.ts` | Erro de execução, refresh 401/403, erro upstream |

Auditar: retry versus fallback de conta, timeouts, propagação de `AbortError`,
contabilidade de requests pendentes.

### G5 — Tradução de protocolo e streaming

| Arquivo | Papel |
| --- | --- |
| `src/server/llm-gateway/engine/handlers/chatCore.ts` | Orquestrador do pipeline |
| `src/server/llm-gateway/engine/handlers/chatCore/phases.ts` | Fases: rota, stream mode, tradução, token savers |
| `src/server/llm-gateway/engine/translator/index.ts` | Tradução request/response |
| `src/server/llm-gateway/engine/utils/stream.ts` | Transform SSE, acumulação de usage |
| `src/server/llm-gateway/engine/utils/streamHandler.ts` | Controller, disconnect, first-chunk e stall timeout |
| `src/server/llm-gateway/engine/handlers/chatCore/{streamingHandler,nonStreamingHandler,sseToJsonHandler}.ts` | Três caminhos de resposta |

Auditar: perda de dados na tradução, timeouts, resposta não-SSE do upstream,
casts `as unknown as` que escondem incompatibilidade de tipo.

### G6 — Catálogo e registry de modelos

| Arquivo | Papel |
| --- | --- |
| `src/server/llm-gateway/engine/providers/registry/*` (284 arquivos) | Uma entrada por provider |
| `src/server/llm-gateway/engine/providers/registry/index.ts` | Barrel dito "auto-gerado" |
| `src/server/llm-gateway/engine/providers/index.ts` | Carrega o registry em `PROVIDERS`, `PROVIDER_MODELS`, `PROVIDER_OAUTH`, `PROVIDER_MEDIA` |
| `src/server/llm-gateway/engine/providers/{schema,capabilities,pricing,thinkingLevels}.ts` | Contrato e fatos por modelo |
| `src/server/llm-gateway/engine/config/providerModels.ts` | Acessores reais do catálogo |
| `src/shared/llm-catalog/index.ts` | Projeção client-safe (na prática, re-export) |
| `src/shared/constants/providers.ts` | Projeção tipada para o dashboard |

Auditar: contrato das entradas, duplicação de fatos, drift entre projeções,
inexistência do gerador do índice.

### G7 — Disponibilidade, aliases, custom/disabled e discovery

| Arquivo | Papel |
| --- | --- |
| `src/lib/db/repos/modelAvailabilityRepo.ts` | Locks e limpeza |
| `src/lib/db/repos/aliasRepo.ts` | Aliases e modelos custom no `kv` |
| `src/lib/db/repos/disabledModelsRepo.ts` | Modelos desabilitados por alias |
| `src/app/api/models/{route,alias,custom,disabled,discovered,free,availability}` | APIs de gerenciamento |
| `src/server/llm-gateway/engine/services/*Models.ts` | Discovery ao vivo por provider |
| `src/server/application/use-cases/http/v1/models/*` | `buildModelsList` |
| `src/app/api/v1/models/info/route.ts`, `src/app/api/v1beta/models/route.ts` | Listagens paralelas |

Auditar: efeito real de desabilitar um modelo, coerência entre as seis
listagens, cache de discovery, limpeza de locks expirados.

### G8 — Observabilidade: usage, custo e trace

| Arquivo | Papel |
| --- | --- |
| `src/server/llm-gateway/engine/host/usage.ts` | Seam único do engine para persistência de uso |
| `src/server/llm-gateway/engine/utils/usageTracking.ts` | Extração, merge e normalização de tokens |
| `src/server/llm-gateway/engine/handlers/chatCore/requestDetail.ts` | Detalhe por request e `saveUsageStats` |
| `src/lib/db/repos/{usageRepo,usageAnalytics,requestDetailsRepo}.ts` | Persistência e agregação |
| `src/lib/db/repos/pricingRepo.ts` | Preço com merge do banco |
| `src/server/llm-gateway/engine/services/routingTrace.ts` | Trace de roteamento |

Auditar: consistência de custo, duplicidade de fonte de preço, buffer de tokens
aplicado ao usage devolvido ao cliente, gravações silenciosas.

---

## Achados

Severidade: P0 quebra confiabilidade em operação normal; P1 degrada operação ou
esconde estado; P2 dívida técnica com risco de erro futuro.

| # | Sev | Grupo | Achado | Status |
| --- | --- | --- | --- | --- |
| 1 | P0 | G3 | Cooldown de noAuth aplicado a todo provider: em `application/chat.ts`, `handleNoAuthCooldownResult` dispara para qualquer 429/402, sem checar `noAuth`. Consequência: rotação entre contas nunca acontece no caso mais importante (rate limit), `markAccountUnavailable` não é chamado, e uma conta limitada bloqueia o provider inteiro por 15-30 s em processo. | corrigido |
| 2 | P0 | G3 | `checkFallbackError` devolve `shouldFallback: true` para qualquer erro não mapeado, e `ERROR_RULES` não cobre 400/413/422. Um request malformado do cliente derruba todas as contas do provider em cooldown de 30 s, uma chamada upstream por conta, e o cliente recebe 503 em vez do 400 real. | corrigido |
| 3 | P1 | G1 | `/responses` é destino de rewrite para o gateway mas não está em `PUBLIC_PREFIXES` do `dashboardGuard`. O request cai no `NextResponse.next()` final e escapa da exigência de API key na borda. Com `requireApiKey` desligado (opção suportada) o endpoint fica aberto. | corrigido |
| 4 | P1 | G7 | Desabilitar um modelo só filtra listagens. `getDisabledModels` não é consultado em nenhum ponto do caminho de request, então o modelo continua roteável por `/v1/chat/completions`. Decisão de produto pendente. | corrigido |
| 5 | P1 | G7 | Seis implementações independentes de listagem de modelos. Só `buildModelsList` aplica disabled/custom/alias/combo; `/api/v1/models/info` e `/api/v1beta/models` leem `PROVIDER_MODELS` direto e anunciam modelo desabilitado. | corrigido |
| 6 | P1 | G8 | Preço calculado por dois caminhos: `pricingRepo` com merge do banco (usado na cobrança de uso) e `providers/pricing.ts` estático (usado no smart routing). O mesmo request pode ser precificado de duas formas. | corrigido |
| 7 | P1 | G3/G7 | `cleanupExpiredModelAvailability` só roda no GET do dashboard. `docs/OPERATIONS.md` afirma que a limpeza é automática, o que hoje não é verdade. | corrigido |
| 8 | P1 | G1 | Gate `requireApiKey` reimplementado em 8 arquivos de `application/`, com log divergindo entre as cópias. Endpoints de metadados (`/api/v1/models`, `/api/v1/models/info`, `/api/v1/models/[kind]`, `/api/v1beta/models`, `/api/v1/audio/voices`, `/api/v1/messages/count_tokens`) não têm gate próprio e dependem só da borda. | consolidado; metadados seguem só na borda |
| 9 | P1 | G3 | Cobertura de teste zero no núcleo: nenhum teste tocava `getProviderCredentials`, `markAccountUnavailable`, `checkFallbackError` ou o cooldown de noAuth. | corrigido |
| 10 | P2 | G3 | Em `accountSelection.ts`, quando todas as contas estão travadas, o `lastError` reportado vem de `lockedConns[0]` e não da conexão com o `until` mais próximo. Mensagem pode citar erro de outra conta. | corrigido |
| 11 | P2 | G6 | `registry/index.ts` se declara auto-gerado, não existe gerador no repositório, e a numeração é esparsa (editado à mão). Adicionar provider exige dois passos e nada falha se o segundo for esquecido. | corrigido (guarda de teste) |
| 12 | P2 | G6 | Contrato das entradas do registry é só JSDoc (`providers/schema.ts`); downstream tudo é `Record<string, unknown>`. Erro de digitação em campo é silencioso. | corrigido |
| 13 | P2 | G6 | Fatos duplicados por modelo: variantes ponto/hífen do id, entradas exatas repetidas por padrão glob em `capabilities.ts` e `pricing.ts`, `MEDIA_KEYS` copiado em `shared/constants/providers.ts`, metadata de discovery copiada byte a byte em duas rotas. | corrigido |
| 14 | P2 | G5 | Literais UTF-8 duplo-codificados em fontes do `chatCore` (emoji de log sai como mojibake no console do operador). | corrigido |
| 15 | P2 | G5 | Uso extenso de `as unknown as Parameters<typeof f>[0]` entre `chatCore` e seus handlers: os tipos não encaixam de fato e o compilador não protege essas fronteiras. | corrigido |
| 16 | P2 | G3 | `selectionMutex` é global e serializa a seleção de conta de todos os providers, não por provider. | corrigido |
| 17 | P1 | G5 | Provider com `forceStream`, cliente pedindo JSON e upstream respondendo com content-type não-SSE: `handleForcedSSEToJson` devolve `null` e o fluxo caía no ramo de streaming, entregando SSE a quem pediu JSON. | corrigido |

---

| 18 | P0 | G5 | Descoberto ao corrigir o 15: o tradutor de Responses grava `_customToolNames` como array, e os dois caminhos de resposta JSON chamavam `.has()` nele. Cliente usando ferramenta custom contra provider que força streaming recebia `TypeError`. As conversões duplas de tipo escondiam a divergência. | corrigido |

## Correções aplicadas

| Achado | Mudança | Arquivos |
| --- | --- | --- |
| 1 | Cooldown de noAuth passa a checar o flag `noAuth` do provider dentro do próprio módulo, então nenhum call site pode esquecer. 429/402 em provider credenciado volta a percorrer o loop de contas. | `application/noAuthCooldown.ts` |
| 2 | Novo `isClientRequestError` (400/413/422) usado por `markAccountUnavailable`: erro do cliente volta ao chamador sem gravar cooldown e sem rotacionar. Fallback entre modelos em combo continua igual, porque lá um modelo diferente pode aceitar o corpo. | `engine/services/accountFallback.ts`, `auth/accountSelection.ts` |
| 3 | `/responses` entra na allowlist de borda, e um teste deriva a allowlist dos rewrites do `next.config.ts` — qualquer rewrite novo para `/api/v1*` sem a entrada correspondente falha. | `dashboardGuard.ts`, `tests/unit/dashboardGuard.test.ts` |
| 7 | Varredura de cooldowns expirados no tick que já existia (refresh proativo de token), em vez de depender do GET do dashboard. Fail-open. | `auth/backgroundTokenRefresh.ts` |
| 8 | Gate de API key extraído para um módulo único, consumido pelos 8 handlers. Mesma resposta 401, log agora consistente. | `application/gatewayApiKey.ts` + os 8 handlers |
| 10 | O erro reportado quando todas as contas estão travadas passa a ser o da conta que destrava primeiro. | `auth/accountSelection.ts` |
| 11 | Teste de guarda garante que todo arquivo do registry é importado (ativo) ou explicitamente estacionado com import comentado, e que o array exportado tem exatamente os imports ativos. | `tests/unit/providerCatalog.test.ts` |
| 13 | `pickDiscoveredMetadata` e sua lista de chaves passam a viver no repo dono do conceito, eliminando a cópia byte a byte entre duas rotas. | `lib/db/repos/aliasRepo.ts`, `api/models/{custom,discovered}/route.ts` |
| 14 | 245 literais duplo-codificados reparados em 8 arquivos (incluindo os emoji de log do `chatCore`), com validação de UTF-8 estrito por trecho. | 8 arquivos em `src/` |
| 16 | Lock de seleção de conta passa a ser por provider, não global. | `auth/accountSelection.ts` |
| 17 | Quando a conversão SSE→JSON declina (upstream não-SSE), o request vai para o handler JSON em vez do ramo de streaming. Seguro porque o handler declina antes de ler o corpo, e há teste fixando essa pré-condição. | `engine/handlers/chatCore.ts`, `tests/unit/forcedSseToJson.test.ts` |
| 4 | Guarda única de modelo desabilitado, consultada pelos 6 handlers que resolvem modelo. Fail-open: banco indisponível não derruba o roteamento. Responde 404 nomeando o modelo. | `application/modelResolution.ts` + 5 handlers, `tests/unit/disabledModelRouting.test.ts` |
| 5 | `/v1/models/info` e `/v1beta/models` passam a respeitar desabilitados, e o mapa kind→endpoint de `models/info` passa a derivar do catálogo. Isso corrigiu o caminho anunciado para web fetch, que apontava para rota inexistente. | `api/v1/models/info/route.ts`, `api/v1beta/models/route.ts`, `shared/constants/providers.ts`, `tests/unit/mediaKindEndpoints.test.ts` |
| 6 | Smart routing passa a resolver preço como a cobrança resolve: sobreposição do operador primeiro, tabela estática depois. Uma leitura por refresh, não uma por modelo. | `smart-routing/inventory.ts`, `repos/pricingRepo.ts`, `engine/host/store.ts`, `tests/smart-routing/ranking.test.ts` |
| 9 | Loop de rotação de contas coberto por teste: rotação em 429, parada em erro de cliente, esgotamento das contas, provider sem conexão e modelo desabilitado. | `tests/unit/accountFallbackLoop.test.ts` |
| 12 | Contrato do registry virou interface TypeScript com os 38 campos realmente usados, mais guarda de runtime que rejeita campo de topo fora do contrato nas 280 entradas. O bloco `media` que o JSDoc descrevia não existia em nenhuma entrada. | `providers/schema.ts`, `registry/index.ts`, `tests/unit/providerCatalog.test.ts` |
| 13 | Lista de chaves de mídia passa a ter uma única definição, consumida pelo loader do engine e pela projeção do dashboard. | `providers/mediaKeys.ts`, `providers/index.ts`, `shared/constants/providers.ts` |
| 15 | Conversões duplas no pipeline de chat caíram de 25 para 7, e nenhuma resta no orquestrador. `RequestLogger` e `StreamController` passaram a ter uma única declaração, no módulo dono; `toolNameMap` e `customToolNames` passaram a declarar as formas reais (`Map` e array); `withCapacityAdapterStripping` virou genérica. | `utils/requestLogger.ts`, `utils/streamHandler.ts`, `utils/stream.ts`, `chatCore/{types,phases,streamingHandler,nonStreamingHandler,sseToJsonHandler}.ts`, `services/capacityAdapter.ts` |
| 18 | `customToolNames` passa a ser array nos dois caminhos JSON, com `includes` em vez de `has`. | `chatCore/{sseToJsonHandler,nonStreamingHandler}.ts`, `tests/unit/customToolCallShape.test.ts` |

Testes novos: `tests/unit/accountFallbackPolicy.test.ts` (classificação de erro do cliente, escopo do cooldown de noAuth, lock por provider), `tests/unit/gatewayApiKey.test.ts` (gate de API key), mais os casos acrescentados em `dashboardGuard.test.ts` e `providerCatalog.test.ts`.

## Decisões tomadas

- **Achado 4, modelo desabilitado deixa de ser roteável.** Desabilitar passou a
  significar desabilitar, não apenas esconder da lista. A guarda responde 404
  nomeando o modelo, e falha aberto: se o banco de desabilitados não responder,
  o roteamento continua em vez de cair junto. Quem desabilitava modelo só para
  limpar a lista do dashboard passa a receber erro ao chamá-lo direto, o que é
  o comportamento pretendido.
- **Achado 12, contrato do registry.** A interface admite índice de string, o
  mesmo padrão que `ProviderCatalogEntry` já usava, porque as 283 entradas não
  são anotadas individualmente e o compilador não pegaria campo desconhecido de
  todo modo. A detecção de campo fora do contrato ficou com a guarda de runtime,
  que cobre as 280 entradas de uma vez.
- **Achado 15, casts restantes.** Sobraram 7, todos em diagnóstico e log
  (headroom, thinking, logger), nenhum no orquestrador nem em dado que segue
  para o provider. Os que restam não escondem divergência de forma de dado.
- **Achado 5, escopo da consolidação.** `/v1/models/info` é consulta de um
  modelo, não listagem, então não foi reescrito sobre `buildModelsList`. Ganhou
  o filtro de desabilitados e passou a derivar o mapa de endpoints do catálogo.

---

## Segunda auditoria: validação e teste de provider e modelo

Área fora do escopo da primeira auditoria, levantada depois. Eram 2.341 linhas
em duas famílias com arquiteturas diferentes respondendo à mesma pergunta.

### Achados da validação

| # | Sev | Achado | Status |
| --- | --- | --- | --- |
| V1 | P0 | Teste aprovado não limpava `errorCode` nem `backoffLevel`. O operador via verde enquanto o despachante mantinha a conexão penalizada. | corrigido |
| V2 | P0 | Espelho do V1: um request bem-sucedido só limpava a penalidade em linha com o valor legado `unavailable`, então conexão comum ficava com `backoffLevel` para sempre. | corrigido |
| V3 | P1 | `testStatus` tinha seis produtores e quatro valores, sem tipo, contra a invariante de `ARCHITECTURE.md`. Escreviam nela o runtime no refresh de token, treze rotas de importação de OAuth, as branches de reparo e o próprio navegador. | corrigido |
| V4 | P1 | A rota de teste descartava `latencyMs`, `testedAt`, `diagnosis` e `statusCode`, que já calculava. | corrigido |
| V5 | P1 | Rota `test-models` sem nenhum chamador, com warm-up serial e busca de modelos ao vivo inalcançáveis. O dashboard refazia o fan-out no cliente. | removida |
| V6 | P1 | `src/shared/services/quotaAutoPing.ts` era cópia byte a byte da versão em `server/`, órfã, declarando o mesmo singleton global. | removida |
| V7 | P1 | Cinco convenções de retorno na família `validate`, duas delas misturando resposta HTTP com resposta de domínio dentro do probe. | corrigido |
| V8 | P1 | Cinco pontos do cliente chamavam `/api/models/test` com normalização própria, dois deles hooks vizinhos com políticas de retry diferentes. | corrigido |
| V9 | P2 | `case "deepgram"` inalcançável no switch de validate, e com URL divergente do registry. | removido |
| V10 | P2 | O mesmo nome `testStatus` designava status de conexão e resultado de teste de modelo, com vocabulários diferentes, na mesma pasta. | corrigido |
| V11 | P2 | Valor sintético `testStatus: "usage"` numa rota de leitura, que a UI não lê. | removido |
| V12 | P1 | Dezoito construtores de request na família `test`, nenhum passando pela camada de executor, com conhecimento de transporte copiado do registry. | corrigido |

### O que foi feito

- **Dono único do `testStatus`.** Tipo fechado `ConnectionTestStatus` com
  `active`, `error` e `unknown`, normalização na leitura da linha e migração 008
  reescrevendo os blobs legados. Os call sites passaram a declarar fatos, não
  valores: a rota de criação e a de atualização aceitam `validated`, e as rotas
  de aquisição de credencial usam uma constante. Um gate em
  `tests/unit/connectionTestStatusOwner.test.ts` falha se qualquer arquivo fora
  dos três donos nomear um valor de status.
- **Penalidade de runtime coerente.** Teste aprovado limpa `errorCode` e
  `backoffLevel`; teste reprovado não os inventa; request bem-sucedido limpa
  quando há algo a limpar.
- **Um tipo de resultado de probe.** `ProbeResult` em
  `server/llm-gateway/probe/types.ts`, com `probeOk`, `probeFailed` e
  `verdictFromStatus`. `NextResponse` saiu de todos os probes da família
  `validate`; a rota converte para HTTP num único ponto, preservando os status
  atuais por meio do campo `configError`.
- **Um probe de modelo no cliente.** `providers/probeModel.ts` atende os cinco
  pontos de chamada; a política de retry segue em `modelTestHelpers`.
- **Deleções.** Cerca de 480 linhas: a rota `test-models`, o `quotaAutoPing`
  órfão e o caso morto de Deepgram.

### O motor de probe

`server/llm-gateway/probe/probeCredential.ts` resolve URL e autenticação pelo
descritor de transporte do registry, com o literal de cada plano servindo
apenas de fallback documentado quando o registry não declara `validateUrl`.
Cinco estratégias cobrem tudo que antes eram dezoito construtores de request:
GET com Bearer numa listagem, GET com esquema alternativo como Token ou Key,
GET com a chave na query string, POST de chat de um token, e POST no formato
Anthropic. A função de fetch é injetada, então a rota de teste segue usando o
proxy de conexão e a de validate segue usando o fetch com guarda de SSRF, sem
o motor conhecer nenhum dos dois.

As quatro tabelas de lookup e os braços colapsáveis do switch saíram. Sobraram
handlers apenas para o que é de fato especial: os nós compatíveis, cuja URL
base vem da conexão, Cloudflare e Azure, que exigem dado específico da conta,
Qoder, que precisa de troca de token antes, e Pollinations, cuja semântica de
saldo esgotado é um aviso e não uma falha.

O diretório entrou na lista `noUnknownAsCasts` de
`tests/unit/architectureGates.test.ts`, então a fatia fica travada.

Fica registrado também que o teste de modelo passa pelo pipeline real do
gateway, então ele já alimenta `modelAvailability` nos dois sentidos. O que não
existe é fixar a conexão: o botão sugere testar aquela conexão e na prática
testa o provider como roteado. Fixar exige expor a conexão preferida na
admissão do gateway, decisão de produto que não foi tomada.

## Estado final: concluída

Auditoria encerrada. Trinta achados levantados nas duas rodadas, trinta
fechados. `npm run check` verde de ponta a ponta: lint, typecheck, contrato,
cobertura, build, rotas estáticas e `git diff --check`. 720 testes passando,
contra 647 na abertura, e cobertura global de cerca de 10%, contra 6%.

Nada aqui está pendente de implementação. Três itens seguem como registro,
porque são decisão e não trabalho:

1. **Importar credencial por OAuth marca a conexão como não testada.** Uma
   troca de token aceita prova que o endpoint de auth aceitou o grant, não que
   o provider vai atender aquela conta. Reversível na constante
   `TEST_STATUS_ON_CREDENTIAL_ACQUIRED` do repo de conexões.
2. **Modelo desabilitado recusa o request.** Antes a lista só filtrava
   listagens. Reversível removendo a guarda `assertModelEnabled` dos handlers.
3. **O teste de modelo não fixa a conexão.** O botão sugere testar aquela
   conexão e testa o provider como roteado, porque o ping atravessa o pipeline
   do gateway e a seleção de conta acontece lá dentro. Fixar exige expor a
   conexão preferida na admissão do gateway. Não foi feito por ser mudança de
   superfície do gateway sem definição de produto.

O trabalho não foi commitado. A árvore contém também alterações anteriores a
esta auditoria, então o commit deve ser feito com escopo escolhido por quem
conhece o resto do trabalho pendente.
