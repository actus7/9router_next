# PLANO DE MIGRAÇÃO VALIDADO — Open-SSE → Gateway LLM integrado ao Next.js 16

> **Data da revisão:** 27/08/2026
> **Stack confirmada:** Next.js 16.3.2 · React 19.2.8 · TypeScript estrito
> **Status:** plano corrigido; implementação ainda não iniciada
> **Objetivo:** eliminar os nomes legados `src/lib/open-sse/` e `src/sse/` sem duplicar a lógica nas rotas, preservando integralmente protocolos, providers, autenticação, fallback, streaming e integrações operacionais.

---

## 1. Decisão arquitetural

O plano anterior **não deve ser executado como estava**. Ele confundia integração nativa com Next.js com a colocação de toda a lógica dentro de cada `route.ts`.

Route Handlers já são a camada HTTP nativa do App Router e já usam as Web APIs `Request`, `Response`, `ReadableStream` e `TransformStream`. Auth, seleção de conta, fallback, tradução de protocolos, executores e métricas são lógica de aplicação/domínio e devem continuar centralizados fora das rotas.

A arquitetura corrigida adota:

1. **Rotas finas:** cada `route.ts` valida apenas o contrato HTTP específico e chama um caso de uso central.
2. **Um gateway coeso:** não espalhar os atuais `config/`, `utils/`, `services/`, `providers/` e `handlers/` em pastas genéricas de `src/lib/`.
3. **Sem duplicação por endpoint:** as seis variantes de chat compartilham o mesmo orquestrador; diferenças de OpenAI, Claude, Responses, Gemini e Ollama permanecem em adapters/translators.
4. **Streams Web preservados:** helpers customizados permanecem quando implementam semântica real de SSE, tradução, cancelamento, backpressure, logging ou usage.
5. **Fronteira server/client explícita:** código com credenciais, banco, filesystem, processos, OAuth ou chamadas upstream não pode entrar no bundle cliente.
6. **Migração sem mudança funcional:** mover/renomear e alterar comportamento são etapas separadas.
7. **APIs do Next.js usadas caso a caso:** `after`, cache e `connection` não são metas de cobertura nem requisitos para todas as rotas.

O nome `open-sse` pode desaparecer, mas seu papel arquitetural não. O resultado será um **gateway LLM interno**, não 15 implementações parcialmente repetidas dentro de Route Handlers.

---

## 2. Baseline validado no repositório

Inventário medido no checkout atual:

| Item | Estado confirmado |
|---|---:|
| `src/lib/open-sse/` | 356 arquivos · 47.733 linhas físicas |
| `src/sse/` | 13 arquivos · 2.566 linhas físicas |
| `src/app/api/**/route.ts` | 150 Route Handlers |
| `src/app/api/` completo | 153 arquivos · 15.069 linhas físicas |
| Importadores de `@/lib/open-sse` | 53 arquivos · 123 ocorrências |
| Importadores de `@/sse/` | 20 arquivos · 21 ocorrências |
| Testes `*.test.*` / `*.spec.*` | 0 |
| Script `test` | inexistente |
| `cacheComponents` | não habilitado em `next.config.ts` |
| `serverExternalPackages` | nenhuma referência a `open-sse` |

Observações importantes:

- O commit `96e58a1` internalizou deliberadamente o motor Open-SSE em TypeScript dois dias antes desta revisão. Uma redistribuição imediata de 356 arquivos em pastas genéricas desfaria essa fronteira coesa sem benefício funcional demonstrado.
- O código de streaming já utiliza `ReadableStream`, `TransformStream` e `Response` nativos. O problema não é falta de Web Streams.
- O motor não é totalmente agnóstico ao host: há dependências de `usageDb`, OAuth, catálogo compartilhado e SSRF guard. Essas dependências precisam de adapters ou de uma fronteira documentada antes de o núcleo ser tratado como independente.
- `/v1/models`, `/api/models` e `/api/pricing` leem banco, aliases, modelos desabilitados, conexões, credenciais ou overrides do usuário. Cache global nessas respostas pode vazar ou servir estado incorreto.
- O scheduler de refresh de token pressupõe processo Node de longa duração. Inicializá-lo em `instrumentation.ts` sem contrato de deploy, idempotência entre instâncias e, se necessário, lease distribuído pode criar múltiplos schedulers.

### 2.1 Estado das verificações em 27/08/2026

| Verificação | Resultado observado |
|---|---|
| `npm run build` | bundle compilou em 8,2 s, mas a etapa TypeScript falhou com erros preexistentes; houve também avisos de tracing dinâmico de filesystem/processos |
| `npm run lint` | não concluiu nem produziu saída após mais de 2 minutos; foi interrompido |

Logo, o baseline **não está verde**. Nenhuma fase poderá alegar “sem regressão” até que os gates sejam reproduzíveis ou que os erros existentes sejam inventariados e corrigidos antes da migração.

---

## 3. Erros corrigidos do plano anterior

| Afirmação/ação anterior | Correção |
|---|---|
| “Route handlers autocontidos” com auth/fallback em cada rota | Manter rotas finas e um orquestrador compartilhado |
| Substituir helpers SSE por um `ReadableStream.start()` simplificado | Preservar parser incremental, tradução, `[DONE]`, eventos nomeados, cancelamento, backpressure, usage e logging |
| `"use cache"` diretamente no corpo de `GET` | Em Route Handlers com Cache Components, cachear uma função auxiliar; a documentação instalada proíbe a diretiva diretamente no corpo do handler |
| Cachear `/v1/models`, `/api/models` e `/api/pricing` globalmente | Não cachear dados por conexão/usuário; só considerar helpers puros, com chave e invalidação explícitas |
| Chamar `connection()` em todo `POST` | Remover; métodos não-GET não são cacheados e `connection()` só é necessário em casos específicos de prerenderização |
| Mover todo side effect para `after()` | Usar apenas para trabalho pós-resposta, best-effort e com dados já capturados; persistência crítica e métricas dependentes do stream permanecem no pipeline |
| Iniciar refresh periódico obrigatoriamente em `instrumentation.ts` | Instrumentation fica voltada à observabilidade; scheduler exige estratégia compatível com o ambiente de deploy |
| Criar caminhos `src/app/api/api/...` | Manter `src/app/api/models`, `src/app/api/pricing`, etc.; `api/api` mudaria URLs para `/api/api/*` |
| Espalhar o motor em `src/lib/config`, `src/lib/utils`, `src/lib/services`, etc. | Manter um bounded context `llm-gateway`; evitar colisões como `src/lib/utils.ts` e serviços de outros domínios |
| Considerar a Fase 1 “baixo risco” e puramente mecânica | Tratar 356 arquivos, side effects de registro e imports dinâmicos como risco alto de integração |
| Validar apenas com `rg` e build | Exigir contratos HTTP/SSE, testes determinísticos, providers reais autorizados e smoke test do deploy |
| Remover diretórios nas Fases 2 e 5 | Remover uma única vez, somente após todos os consumidores migrarem |
| Usar `rm -rf` no fluxo Windows | Usar `git mv` durante a migração e remoção explícita/revisável ao final |
| Atualizar o `AGENTS.md` raiz para remover Open-SSE | Preservar o bloco gerado do Next.js; migrar e corrigir o `src/lib/open-sse/AGENTS.md` junto com o módulo |

---

## 4. Arquitetura alvo

Estrutura recomendada, mantendo inicialmente as subdivisões atuais para reduzir churn:

```text
src/
├── app/
│   └── api/                           # Route Handlers finos; URLs existentes não mudam
├── server/
│   └── llm-gateway/
│       ├── application/               # orquestração hoje em src/sse/handlers
│       ├── auth/                      # seleção de conta e validação de chave
│       ├── engine/                    # antigo open-sse, ainda como módulo coeso
│       │   ├── config/
│       │   ├── executors/
│       │   ├── handlers/              # cores por modalidade
│       │   ├── providers/
│       │   ├── rtk/
│       │   ├── services/
│       │   ├── shared/
│       │   ├── transformer/
│       │   ├── translator/
│       │   └── utils/                 # SSE/Web Streams e transformação
│       ├── utils/                     # utilidades da camada de aplicação
│       ├── index.ts                   # API pública server-only
│       └── AGENTS.md
└── shared/
    └── llm-catalog/                   # somente tipos/metadados puros usados por server e client
```

### 4.1 Regra de dependências

```text
Client Components ──> shared/llm-catalog
Route Handlers ─────> server/llm-gateway/index
llm-gateway ────────> shared/llm-catalog + adapters de DB/OAuth/rede
shared/llm-catalog ─X─> server/llm-gateway
```

Regras:

- `src/server/llm-gateway/index.ts` e entrypoints por modalidade são a API pública do servidor.
- Deep imports vindos de `src/app/` e `src/shared/` devem ser eliminados gradualmente e depois bloqueados no ESLint.
- Módulos client-safe não podem importar `node:*`, banco, secrets, `server-only`, executores ou serviços OAuth.
- Rotas do gateway devem usar runtime Node quando dependem de filesystem, processos, SQLite ou outras APIs Node. Edge não é meta desta migração.
- O registro por side effect de translators/providers deve continuar determinístico e coberto por teste.

### 4.2 Superfície HTTP preservada

Os diretórios permanecem sob `src/app/api/`, sem o nível extra `api/` proposto anteriormente. Entre os contratos críticos:

- `/v1/chat/completions`
- `/v1/messages`
- `/v1/responses`
- `/v1/responses/compact`
- `/v1/api/chat`
- `/v1beta/models/[...path]`
- `/v1/embeddings`
- `/v1/search`
- `/v1/web/fetch`
- `/v1/audio/speech`
- `/v1/audio/transcriptions`
- `/v1/images/generations`
- `/v1/videos/generations`
- `/v1/videos/edits`
- `/v1/videos/extensions`
- `/v1/videos/[id]`

Também permanecem as rotas internas de modelos, pricing, usage, providers, translator, OAuth e MCP que consomem partes do gateway.

---

## 5. Estratégia de testes antes de mover código

Não existe suíte automatizada hoje. Criá-la é pré-condição, não melhoria opcional posterior.

### 5.1 Scripts mínimos a adicionar

```jsonc
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:contract": "vitest run tests/contracts",
    "check": "npm run lint && npm run typecheck && npm run test && npm run build"
  }
}
```

O runner pode ser ajustado durante a implementação, mas deve suportar streams Web, timers e mocks de `fetch`. Nenhum fixture pode conter chaves, tokens ou dados pessoais reais.

### 5.2 Pirâmide de validação

1. **Unitário:** model parsing, escolha de provider/conta, fallback, capability detection, translators, RTK fail-open e normalizadores.
2. **Contrato do gateway:** status, headers, body, erros e callbacks por modalidade com upstream simulado.
3. **Contrato HTTP:** Route Handlers e rewrites preservam método, URL, CORS, autenticação e formatos.
4. **Contrato SSE:** sequência semântica de eventos, terminação, usage, UTF-8 dividido entre chunks, abort do cliente e erro upstream.
5. **Integração real autorizada:** pelo menos um provider por família crítica, usando apenas secrets do ambiente.
6. **Smoke de deploy:** executar no mesmo tipo de runtime usado em produção.

### 5.3 Casos SSE obrigatórios

- OpenAI Chat Completions com e sem `stream`.
- Anthropic Messages com blocos de thinking e tools.
- OpenAI Responses com eventos nomeados e exatamente um terminal.
- Gemini native e suas particularidades de framing.
- Ollama NDJSON.
- `[DONE]` presente somente quando o protocolo exige.
- Sem duplicação de evento final ou de gravação de usage.
- Code point UTF-8 dividido entre chunks.
- Cliente aborta no meio da resposta e o upstream é cancelado.
- Resposta parcial seguida de falha.
- Backpressure não acumula o corpo inteiro em memória.

Comparar a semântica dos eventos, não o tamanho exato dos chunks, que pode variar por runtime.

---

## 6. Plano de execução por fases

### FASE 0 — Corrigir e congelar o baseline

**Objetivo:** começar a migração a partir de um estado mensurável.

1. Criar branch dedicada somente se ainda não houver uma branch de trabalho definida:

   ```powershell
   rtk git switch -c refactor/llm-gateway
   ```

2. Inventariar e corrigir os erros atuais de TypeScript que impedem `next build`.
3. Diagnosticar o lint que não conclui; definir timeout no CI e excluir somente artefatos gerados comprovados.
4. Adicionar os scripts e a suíte mínima da seção 5.
5. Gerar um manifesto versionado de Route Handlers com método e pathname.
6. Capturar fixtures sanitizados dos contratos atuais.
7. Registrar os avisos de tracing atuais e impedir aumento durante a migração.

**Gate de saída:** `lint`, `typecheck`, testes e build passam de forma reproduzível; o manifesto de rotas e os contratos críticos estão versionados.

---

### FASE 1 — Criar a fronteira pública do gateway

**Objetivo:** reduzir deep imports antes de mover 356 arquivos.

1. Criar entrypoints server-only por modalidade:

   ```text
   src/server/llm-gateway/index.ts
   src/server/llm-gateway/chat.ts
   src/server/llm-gateway/embeddings.ts
   src/server/llm-gateway/media.ts
   src/server/llm-gateway/catalog.ts
   ```

2. Inicialmente, esses entrypoints podem reexportar as implementações atuais.
3. Alterar Route Handlers para importar apenas desses entrypoints, sem copiar lógica.
4. Identificar módulos realmente client-safe e movê-los para `src/shared/llm-catalog/`.
5. Substituir imports do dashboard por entrypoints client-safe.
6. Adicionar regra para impedir novos deep imports legados fora do gateway.

**Gate de saída:** contratos idênticos ao baseline; nenhuma lógica de auth/fallback foi duplicada em `route.ts`.

**Rollback:** reverter somente os entrypoints e imports, sem alteração de comportamento interno.

---

### FASE 2 — Consolidar `src/sse/` como camada de aplicação

**Objetivo:** eliminar o nome genérico `src/sse/` preservando o orquestrador único.

1. Mover com histórico, por grupos pequenos:

   ```text
   src/sse/handlers/*                 → src/server/llm-gateway/application/*
   src/sse/services/auth.ts           → src/server/llm-gateway/auth/accountSelection.ts
   src/sse/services/model.ts          → src/server/llm-gateway/application/modelResolution.ts
   src/sse/services/tokenRefresh.ts   → src/server/llm-gateway/auth/tokenRefresh.ts
   src/sse/services/backgroundTokenRefresh.ts
                                      → src/server/llm-gateway/auth/backgroundTokenRefresh.ts
   src/sse/utils/logger.ts            → src/server/llm-gateway/utils/logger.ts
   ```

2. Migrar uma modalidade por commit: embeddings, search/fetch, mídia, vídeo e chat por último.
3. Manter chat/combo/fusion/capacity/fallback em uma única cadeia compartilhada.
4. Atualizar `initializeApp.ts` somente depois que o novo entrypoint estiver testado.
5. Confirmar que não restam consumidores de `@/sse/`.

**Gate de saída:** zero imports `@/sse/`; diretório removido; todos os testes de contrato continuam verdes.

---

### FASE 3 — Renomear o bounded context Open-SSE

**Objetivo:** remover o namespace legado sem espalhar o motor.

1. Mover o diretório coeso com `git mv`, preservando inicialmente sua topologia interna:

   ```text
   src/lib/open-sse/* → src/server/llm-gateway/engine/*
   ```

2. Atualizar imports com codemod determinístico e revisar o diff; não usar substituição cega em strings, comentários ou fixtures.
3. Manter imports internos relativos quando isso reduzir churn.
4. Migrar `src/lib/open-sse/AGENTS.md` para o novo módulo e corrigir referências `.js` obsoletas para `.ts`.
5. Eliminar reexports temporários após todos os consumidores migrarem.
6. Não mover arquivos para `src/lib/utils`, `src/lib/services` ou `src/lib/config` globais.

**Gate de saída:** zero imports executáveis contendo `open-sse`; registro de providers/translators completo; catálogo e protocolos idênticos.

**Rollback:** reverter o commit de rename sem depender de mudanças funcionais da Fase 4.

---

### FASE 4 — Desacoplar o motor do host

**Objetivo:** tornar explícitas as integrações que hoje atravessam a fronteira do motor.

Criar interfaces/adapters para:

- gravação de usage e request details;
- leitura de settings e conexões;
- persistência de credenciais atualizadas;
- OAuth e resolução de project ID;
- `proxyAwareFetch`, em vez de depender indefinidamente de patch global de `fetch`;
- SSRF guard;
- relógio, IDs e logger nos testes.

Os callbacks críticos devem ter semântica documentada: exatamente uma vez, ao menos uma vez ou best-effort. Em especial, `onRequestSuccess`, refresh de credenciais e usage não podem mudar silenciosamente de garantia.

**Gate de saída:** o engine pode ser testado com adapters em memória; dependências de host estão enumeradas e não há ciclos server/client.

---

### FASE 5 — Adotar recursos do Next.js seletivamente

#### 5.1 Streaming

- Manter `ReadableStream`/`TransformStream` existentes quando carregam regra de protocolo.
- Route Handlers retornam `Response` nativa, como já fazem.
- Simplificar helpers somente quando testes provarem redundância.
- Preservar headers, abort propagation, timeout, terminal events e logs.

#### 5.2 `after()`

Usar somente para tarefas que:

- podem ocorrer depois que a resposta terminar;
- não precisam ler novamente o body do `Response`;
- não são necessárias para confirmar sucesso ao cliente;
- toleram o limite de duração da plataforma;
- usam dados capturados antes do callback.

Não mover automaticamente para `after()`:

- persistência de token recém-atualizado;
- marcação de conta indisponível;
- usage calculado durante o consumo do stream;
- cleanup necessário para liberar recursos ou cancelar upstream.

#### 5.3 Cache

Antes de habilitar `cacheComponents`, classificar cada leitura:

| Dado | Política inicial |
|---|---|
| `/v1/models` por conexões/credenciais | não cachear globalmente |
| `/api/models` com aliases/desabilitados | não cachear globalmente |
| `/api/pricing` com overrides do usuário | não cachear globalmente |
| tabela estática de tags/model metadata | candidato a helper cacheado |
| default pricing puramente estático | candidato a helper cacheado |

Quando houver cache:

- colocar `"use cache"`, `cacheLife` e `cacheTag` em função auxiliar assíncrona, nunca diretamente no corpo do Route Handler;
- documentar chave, escopo, fonte de verdade e evento de invalidação;
- testar isolamento entre configurações/usuários/instâncias;
- chamar `revalidateTag` nas mutações correspondentes quando stale-while-revalidate for aceitável.

#### 5.4 `connection()`

- Não usar em `POST`, `PATCH`, `DELETE` ou handlers que já acessam request/runtime data.
- Usar apenas quando for necessário impedir prerenderização de um `GET` que, de outra forma, pareça estático; com Cache Components, avaliar `io()` conforme a documentação instalada.

#### 5.5 Instrumentation e scheduler

- `instrumentation.ts` continua responsável por observabilidade e `onRequestError` tipado como `Instrumentation.onRequestError`.
- O refresh periódico só migra para `register()` se o deploy for Node de longa duração e houver garantia contra duplicação por instância/worker.
- Em serverless ou múltiplas réplicas, usar scheduler externo ou lease distribuído; manter refresh on-demand como proteção.

**Gate de saída:** cada adoção tem teste e justificativa; não existe meta de “usar todas as APIs nativas”.

---

### FASE 6 — Runtime, tracing e segurança

**Objetivo:** não carregar riscos operacionais antigos para o novo namespace.

1. Resolver ou justificar os avisos de tracing dinâmico causados por filesystem e `child_process`.
2. Evitar que imports agregadores tragam todos os executores para rotas que usam apenas um subconjunto.
3. Confirmar que secrets nunca chegam a módulos client-safe, logs ou fixtures.
4. Testar SSRF guard em search/fetch e URLs configuráveis de provider.
5. Testar autenticação obrigatória, chave inválida, ausência de credenciais e mascaramento de logs.
6. Confirmar limites de body, timeout, abort e concorrência.

**Gate de saída:** nenhum novo warning de tracing; bundle e runtime compatíveis com o alvo de deploy; controles de segurança cobertos por testes.

---

### FASE 7 — Remoção final e validação comportamental

1. Confirmar ausência dos namespaces antigos:

   ```powershell
   rtk rg "@/lib/open-sse|@/sse/" src
   rtk git status --short
   ```

2. Confirmar que os diretórios `src/lib/open-sse/` e `src/sse/` não existem.
3. Comparar o manifesto de rotas antes/depois; nenhuma URL ou método pode desaparecer sem decisão explícita.
4. Executar `npm run check`.
5. Executar testes reais autorizados em, no mínimo:
   - provider OpenAI-compatible;
   - Anthropic/Claude;
   - Google/Gemini;
   - Ollama local;
   - um provider OAuth com refresh;
   - combo/fusion/fallback/capacity adapter;
   - RTK fail-open;
   - embeddings, TTS, STT, image, search/fetch e video quando configurados.
6. Validar dashboard no navegador: providers, modelos, aliases, pricing, usage e logs.
7. Validar `next start`/standalone no ambiente de deploy, inclusive scheduler, filesystem e processos auxiliares.
8. Fazer rollout gradual e observar erros, latência, aborts, refresh e usage por pelo menos 24 horas antes de encerrar.

---

## 7. Critérios de aceite

### Estrutura

- [ ] `src/lib/open-sse/` removido.
- [ ] `src/sse/` removido.
- [ ] Nenhum import executável contém `@/lib/open-sse` ou `@/sse/`.
- [ ] Rotas importam apenas entrypoints públicos do gateway.
- [ ] Código client-safe não depende de módulos server-only.

### Qualidade

- [ ] `npm run lint` conclui dentro do timeout definido.
- [ ] `npm run typecheck` passa.
- [ ] `npm run test` passa.
- [ ] `npm run build` passa sem ignorar erros TypeScript.
- [ ] Nenhum warning novo de tracing/bundle.
- [ ] Working tree limpo ao concluir cada marco.

### Contratos

- [ ] Manifesto de rotas, métodos e rewrites preservado.
- [ ] Status, headers, CORS e schemas de erro preservados.
- [ ] OpenAI, Claude, Responses, Gemini e Ollama mantêm seus protocolos.
- [ ] Streams terminam corretamente e propagam cancelamento.
- [ ] Usage e request details são gravados exatamente conforme o contrato definido.
- [ ] Auth, refresh, fallback, combo/fusion e capacity adapter funcionam.
- [ ] Todos os providers registrados antes continuam registrados depois.

### Operação e segurança

- [ ] Scheduler de token é compatível com o modelo de deploy e não duplica trabalho indevidamente.
- [ ] Nenhum secret aparece em código, fixture, log ou bundle cliente.
- [ ] SSRF, timeouts, limites e aborts validados.
- [ ] Smoke test real e validação de navegador concluídos.

Uma pasta removida, um build isolado ou contagem de rotas igual **não** constituem migração concluída sem os critérios comportamentais acima.

---

## 8. Estimativa revisada

Estimativas dependem primeiro da estabilização do baseline:

| Fase | Faixa |
|---|---:|
| 0. Baseline + testes de caracterização | 3–6 dias |
| 1. Entry points e fronteiras server/client | 2–4 dias |
| 2. Consolidação de `src/sse/` | 2–4 dias |
| 3. Rename de `open-sse` | 2–4 dias |
| 4. Adapters do host | 3–6 dias |
| 5. Adoção seletiva de APIs Next.js | 2–4 dias |
| 6. Runtime, tracing e segurança | 2–5 dias |
| 7. Integração real, deploy e observação | 2–4 dias + 24 h de observação |
| **Total provável** | **18–37 dias** |

Não reduzir a estimativa removendo testes ou validação real; isso apenas transfere o custo para regressões em produção.

---

## 9. Comandos de verificação recorrentes

```powershell
rtk rg "@/lib/open-sse|@/sse/" src
rtk rg --files src/app/api -g route.ts
rtk npm run lint
rtk npm run typecheck
rtk npm run test
rtk npm run build
rtk git diff --check
rtk git status --short
```

As saídas devem ser registradas por fase. Comandos executados sem resultado verde não podem ser marcados como concluídos.
