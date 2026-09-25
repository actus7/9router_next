# ModelHub architecture

## Boundaries

- `src/app/api` adapts HTTP only. It validates input, delegates to the domain, and serializes the public contract.
- `src/server/llm-gateway` owns protocol translation, account selection, provider execution and fallback. Its `engine` is isolated from Next.js and local storage details through `engine/host` seams.
- `src/server/llm-gateway/auth` is a **peer of `engine`, not inside it**, and reaches `src/lib/db/repos` directly — `connectionsRepo`, `proxyPoolsRepo`, `apiKeysRepo`, `modelAvailabilityRepo`, `settingsRepo`. `tests/unit/hostSeam.test.ts` covers what is under `engine/`, so the seam is exhaustive for the engine and not for the gateway as a whole. Read "everything the gateway touches is in `host/`" and you will underestimate the surface by those five repos; account selection, the mutex and the fallback loop all live here. Kept this way on purpose: the seam exists for testability, and `accountSelection` is already testable by mocking those repos.
- `src/shared/llm-catalog` is the server registry projection. `src/shared/constants/providers.ts` is its typed, client-safe dashboard projection; UI code must use its selectors instead of recoding category or authentication rules.
- `src/lib/db` owns persistence. One database — Neon Postgres — reached through a single adapter that translates `?` placeholders and restores camelCase column names, so repo SQL reads the way it always did. The schema is declarative (`schema.ts`) and synced additively on boot — skipped when `_meta.schemaHash` already matches the declared schema, so an unchanged cold start costs one SELECT instead of ~90 round trips; there is no versioned migration chain. Provider availability is normalized in `modelAvailability`; `providerConnections.testStatus` means a connection test result only.
- **A conversation id is unique within an account, not globally.**
  `harnessConversations` was the one per-conversation table keyed on `id`
  alone, so an id one account held was an id another account could never write.
  The upsert that matched nothing threw *inside the sync transaction*, rolling
  back every other conversation and every deletion in the same payload — and
  the client re-sent the same id on its next change, so the account stopped
  syncing permanently. A sync now reports such an id in `rejected` and writes
  the rest. Existing databases need the key swapped by hand (`syncSchema` adds
  the unique index the upsert conflicts on, but never rewrites a primary key):

  ```sql
  ALTER TABLE harnessconversations DROP CONSTRAINT harnessconversations_pkey;
  ALTER TABLE harnessconversations
    ADD CONSTRAINT harnessconversations_pkey PRIMARY KEY (userid, id);
  ```

  Until that runs, the repair above is inert and the bug is *worse* than the
  code reads: the arbiter `(userId, id)` finds no conflict, so the INSERT
  proceeds and hits the surviving global key instead — a `23505` thrown from
  inside the transaction, which is the abort the `rejected` list exists to
  avoid. Applied to the NewModelHub branch on 2026-09-11; any other database
  restored from before that date still needs it.

- **Every row belongs to an account.** Each table but `_meta` carries `userId`, every repo filters on it, and the owner rides an `AsyncLocalStorage` established at four entry points: `tenantRoute` (dashboard API), `gatewayRoute` (API key), `assertDashboardSession` / `requireTenantPage` (Server Actions and Components), and `forEachTenant` (background jobs). Reaching tenant data with no owner throws rather than returning rows. Two tests hold the line: `tenantIsolation` reads the SQL, `tenantRouteCoverage` reads the routes. See `docs/NEON-MIGRATION.md`.
- Identity is Neon Auth and only Neon Auth. There is no operator password, no OIDC/SAML and no way to disable login, because "logged out" would mean "owns nothing".

## Provider model

Each provider has a unique `id`, user-facing alias, category, optional explicit authentication modes, capabilities and discovery flags. Categories organize the dashboard; commercial availability is derived by `getProviderAvailability`, and connection matching by `getProviderConnectionAuthTypes`.

Per-model failures (`402`, `429`, `502`, `503` and model-specific errors) create an availability record with reason, sanitized error and expiry. They never mark the entire connection unavailable.

**"Este modelo não faz tool calling" é erro do request, não da conta.** Um alias
que abre em vários upstreams (kilo-gateway, OpenRouter) responde `404 No
endpoints found that support tool use` quando nada atrás dele faz tool calling —
o caso comum é a variante `:free`. As `tools` vão na requisição porque a
*conversa* tem plugins ligados, não porque o turno precisa delas, então o
gateway as remove e repete a chamada uma vez (`retryWithoutTools`), e o que a
segunda tentativa responder é o que chega ao chamador — inclusive uma falha:
o primeiro erro já foi contornado, e devolver o 404 por cima de um `429` manda
o usuário procurar um switch de plugin quando a resposta era esperar, além de
tirar da conta o backoff que só é classificado a partir do status devolvido.

Esse 404 também **não rotaciona contas** (`isClientRequestError`): a conta
seguinte tem os mesmos endpoints atrás do mesmo alias, então travá-la por
`COOLDOWN.long` só empurrava o prompt para o provider free default, que o
usuário nunca escolheu. Um 404 comum continua rotacionando — esse sim quer
dizer "não nesta conta".

**Um provider que descarta `tools` diz isso no registry.** `features:
{ toolCalling: false }` (hoje `quillbot` e `duckai`) vira `tools: false` em
`getCapabilitiesForModel`, acima do que o nome do modelo sugere —
`da/claude-haiku-4-5` herdava `tools: true` do Claude canônico. O combo smart
deixa de considerá-lo para `tool_use`, e num combo comum um pedido com `tools`
o tenta por último, sem descartá-lo. O caso que motivou: um pedido de imagem caiu
no Quillbot, que só repassa o texto da mensagem, e o `generate_image` nunca foi
chamado.

**O tipo de um modelo descoberto vem do provider.** A Vercel AI Gateway marca
cada modelo (`language`, `image`, `video`, `speech`, …) e
`discoveredModelKind` (`aliasRepo.ts`) traduz para os nossos tipos; sem marca
continua `llm`. Antes tudo era gravado como `llm`, então os modelos de imagem
da gateway nunca chegavam ao `generate_image`. No inventário do roteamento, um
modelo com tipo é só aquele tipo: herdar os tipos do provider fazia todo modelo
de chat da Vercel ser também "de imagem".

**O padrão sem credencial é o roteador grátis do Kilo** (`kgw/kilo-auto/free`,
`freeDefault.ts`). O Kilo documenta acesso anônimo aos modelos `:free` (200
requisições/hora por IP), então uma conta sem conexão do Kilo recebe a
credencial pública para esses ids (`isAnonymousFreeModel`) — e só para eles; a
chave da conta, quando existe, sempre ganha. A OpenCode, que era o padrão,
passou a recusar com `403 FreeTierError` toda chamada de fora do app dela; um
401/403 de provider `noAuth` agora deixa o provider em cooldown por uma hora em
vez de ser tentado de novo a cada requisição.

Os "200/hora por IP" são do IP de saída, e na Vercel esse IP é compartilhado
— com todas as contas deste servidor e com outros projetos da plataforma. O
padrão sem credencial é portanto *melhor esforço*, não uma garantia: um 429
dele entra no mesmo cooldown dos providers `noAuth` (`noAuthCooldown.ts`),
aplicado só quando a chamada saiu mesmo sem chave (`credentials.id ===
"noauth"`), para que uma conta com a própria chave do Kilo nunca fique presa
nele. Quem precisa de previsibilidade conecta uma chave.

Batch operations must be bounded, cancellable in the UI and report progress; automated tests use mocks only.

## O catálogo de modelos é descoberto, não embarcado

Um provider que responde a um endpoint de listagem **não embarca** array
`models:` no registry. A lista vem do provider; o que fica no repositório é só
o que uma listagem nunca devolve.

A regra vale para as três formas de listar que existem — `PROVIDER_MODELS_CONFIG`
(com a credencial da conexão), um `customResolver`, ou o `modelsFetcher` público
— e é verificada por `tests/unit/dynamicModelCatalog.test.ts`, que falha se um
provider tiver as duas coisas. Os 147 providers sem endpoint algum mantêm o
array: é o único catálogo que eles têm.

O que motivou: o Kilo Gateway embarcava 6 modelos enquanto
`api.kilo.ai/api/gateway/models` devolvia 381, e a tela mostrava os 6. Um
catálogo escrito à mão ao lado de um ao vivo envelhece em silêncio.

Três consequências que precisaram de código, não só de deleção:

- **`modelOverrides`** carrega o que a listagem não diz: `upstreamModelId`,
  `targetFormat`, `supportedFormats`, `quotaFamily`, `strip`, `kind`, `params`.
  `findModel` (`engine/config/providerModels.ts`) mescla o override sobre o
  modelo descoberto, então o roteamento continua mandando o id certo no formato
  certo sem que exista uma lista. Um provider não pode ter `models` e
  `modelOverrides` ao mesmo tempo — um é catálogo, o outro é metadado.
- **A descoberta virou automática** (`use-cases/models/ensureProviderCatalog`).
  Antes só o botão "Refresh Models" do dashboard escrevia modelos descobertos;
  sem catálogo embarcado, isso deixaria o provider invisível no chat, nos
  combos, no smart routing e no `/v1/models` até alguém abrir a tela dele. O
  `/v1/models` **espera** a descoberta de um provider conectado que ninguém
  conhece ainda e revalida os demais em `waitUntil`, com TTL de 6h gravado em
  `kv(meta)` e um cache por processo — chaveados por conta, porque o catálogo é
  descoberto com a credencial de uma conta e gravado nas linhas dela. A tela do
  provider dispara a mesma descoberta uma vez quando encontra catálogo vazio.
- **Listagem vazia é falha, não catálogo vazio.** Os resolvers que caíam no
  array embarcado quando o provider não respondia (`kimchi`, `cursor`,
  `grok-cli`, `zai-web`) devolvem erro 502 com mensagem. Servir uma lista
  congelada como se fosse a atual é o problema que esta seção existe para
  eliminar.

`browserOnlyProviderForModel` perdeu a varredura "quem declara este modelo":
com catálogo dinâmico ela só enxergaria a metade embarcada e chamaria de
browser-only um modelo que outro provider serve. O prefixo `alias/modelo`
decide; sem ele, a resposta é null.

## Durable runs

A chat send does not depend on the browser that started it. `POST /api/harness/runs`
writes a `harnessRuns` row, answers `202` immediately, and runs the provider
call afterwards under `waitUntil` — closing the tab, or the laptop, stops
nothing. The worker rewrites `partialText` about once a second and settles
`status` at the end; `GET /api/harness/runs/[runId]/stream` replays what has
accumulated before following along, so a client that reconnects sees the whole
answer rather than only what arrived after it returned.

Three things are deliberate:

- **The worker writes the finished answer into `harnessConversations`.** It did
  not, and could not: the client replaced that table wholesale on every
  `PUT /api/harness/sessions`, so a background write was raced away. That left
  the answer living only in `harnessRuns`, waiting to be folded in by
  `useDurableRunRecovery` — which reads only the session that happens to be
  open, and only if a browser comes back at all. Settled rows expire after
  `SETTLED_RUN_TTL_MS`, so a laptop closed for a day lost an answer the account
  had already paid for.

  Sync is incremental now (`syncHarnessConversations`): it upserts what the
  client says changed, deletes only ids it is told to delete — recording a
  tombstone so the deletion converges on every device instead of being
  re-uploaded by whichever one still had a local copy — and refuses an upsert
  older than the stored row — reporting it in `stale` so the client
  re-reads rather than overwriting. That is what makes a server-side write
  safe, and it is what makes the browser one reader of the conversation instead
  of its owner. `useDurableRunRecovery` still collects run rows, but it is now
  how a *live* tab catches up, not the only path an answer has.

  A turn the worker could not finish — out of tool steps, or out of its time
  budget — is mirrored as `error`, not `done`. Writing it as an answer would
  file a truncated turn as a complete one; not writing it at all left it to
  expire in `harnessRuns` with nothing said. Its unanswered calls ride along and
  are dropped when the conversation is next serialized.
- **Stop and navigating away are different.** Aborting locally only stops
  watching. An explicit stop `PATCH`es the row to `stopped`; the worker learns
  about it because its next progress `UPDATE ... WHERE status = 'running'`
  matches nothing.
- **A dead worker is settled by its reader.** A serverless invocation can be
  killed without reaching its own error handler — a timeout, a deploy, a dev
  server recompile. The worker therefore touches its row every 5s whatever the
  provider is doing, so silence means death rather than slowness, and any run
  quiet for `STALE_RUN_MS` (60s) is failed by the next reader. Reaping happens
  inside the watcher's poll loop, not only when it connects: the worker can die
  after a watcher has already attached, and a watcher that never reaches a
  terminal state leaves the client's send promise unsettled and its composer
  disabled.
- **A stream that ends without a terminal status is a truncated answer**, and
  the client raises it as one. Returning the fragment as a result would file an
  interrupted answer as a finished message, silently.
- **A live run is never swept.** `syncHarnessConversations` prunes runs for
  sessions missing from a sync payload, but skips `running` rows — deleting one
  under its worker loses the answer with nothing to report it. Settled rows
  also expire after `SETTLED_RUN_TTL_MS`, so a run nobody collects still goes.

Ceilings, all per-account and per-process like the rate limiter beside them:
`MAX_CONCURRENT_RUNS` (12) bounds work in flight, `MAX_WATCHERS_PER_ACCOUNT`
(8) bounds open watchers — each polls Neon on a timer, and Neon is shared by
every tenant — and the delete endpoint caps its id list. The dashboard rate
limit bounds how fast these are *started*, never how many are alive, which is
the quantity that costs anything.

**The tool loop runs in the worker** (`server/harness/tools/serverToolLoop.ts`),
so a turn that needs several tool steps finishes with nothing open. Everything
the browser's executor reaches is an HTTP route on this same server, so the work
already lived here; what lived only in the browser was the loop. Dispatch is
in-process rather than over HTTP, which is also what makes it possible: the
harness routes authenticate with the dashboard session, which a worker does not
have, while an in-process call runs inside the run's `withTenant(owner)`.

`runToolCallLoop` in the browser is still there, and still needed. Two rules
keep the two loops from ever both running a call:

- **A step is all-or-nothing.** Every tool the harness ships runs in the
  worker: search, fetch, delegation, MCP, the harness's own skill/memory/
  governance tools, and media generation. The browser loop is the safety net
  for a tool the worker has no executor for — a future one, or an MCP name that
  is not in the request body. If any call in a step is unknown to the worker,
  none of them run there and the whole set is settled onto the row, which is
  where `executeDurableChat` reads tool calls from.
- **A hand-back only happens before the worker has run anything.** Once it has,
  the earlier tool results exist only in the worker's own message list, so a
  browser continuing the chain would send a history missing them. The turn ends
  there instead and is reported unfinished.

The worker writes `tool/call` and `tool/result` into the run journal, so
server-side tool work is visible rather than text appearing from nowhere.

**Two accidents of environment had to be replaced, not moved.** The browser
base64-encoded generated audio with `btoa`, walking the bytes through
`String.fromCharCode` in 32KB chunks because that is all it had; the worker uses
`Buffer`. And the browser bounded a video poll with an `AbortSignal`, which the
worker does not have — a stop reaches it as a progress write that matches no
row. So every wait in the worker is bounded by the run's own deadline instead.

That deadline is the real ceiling: one run, every tool step included, must
finish inside one invocation (`maxDuration` 300s, and the loop gives itself
`RUN_BUDGET_MS` 240s). A video poll alone was allowed 90s, and eight of those
would be killed by the platform mid-step — leaving the row `running` for the
next reader to settle as dead, losing the whole chain. The loop watches its own
clock and stops in a state it can report. Loops genuinely longer than one
invocation need Vercel Workflow or Queues.

**Verified against the real stack, not against stubs.**
`tests/unit/serverToolLoopLive.test.ts` drives `startDurableRun` against the
real database and the account's real provider, with nothing mocked and nothing
watching the stream. It asserts two things the unit tests cannot: that a tool
call is executed and fed back into a continuation by the worker itself, and
that the `tool/call` / `tool/result` events carry `ranOn: "server"` — which only
the worker writes. `docs/CONVENTIONS.md` records why this matters: this exact
flow reached a user broken twice because every test mocked at least one edge, so
each piece was proven against a stub and the seams were proven by nothing.

The media case in that file is a partial verification by necessity. It asserts
that `generate_image` runs *in the worker*, reading the real model catalogue
against the real database — the result can only have come from
`serverMediaTools`. What it cannot assert is the provider call itself, because
that needs an image, audio or video provider connected to the account. Connect
one and the same test becomes a full verification with no changes.

**The browser's own tool executors are still there, and deliberately.** They
are now unreachable on the durable path — every tool the worker knows about it
runs itself — which makes them duplicated semantics, the thing this repository
otherwise avoids. Keeping them for one release is the cheaper mistake: the
loop is now verified live, but the three media providers' request and response
shapes are not, and that is the part a stub is worst at proving. Delete them
once a media tool has run live against a real provider.

The one thing a browser is still required for is a model that *is* the browser:
Puter runs the completion inside `js.puter.com`, so `executeSendMessage`
branches before the durable path and such a run never becomes a durable run at
all. An approval-gated write no longer needs the browser — the worker queues it
and the operator answers whenever they next look.

## Compatibility

The public gateway protocols remain stable: OpenAI chat/Responses/embeddings, Anthropic, Gemini and SSE. Legacy provider aliases are resolved by the catalog. Schema changes are additive: `syncSchema()` adds missing tables, columns and indexes on boot. A destructive change is run by hand against the Neon branch and then reflected in `schema.ts` — Neon's branching covers the rollback case the old pre-schema backup existed for.
