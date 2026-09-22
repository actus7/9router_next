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

**Roteamento inteligente — tuning do classificador sem UI (decisão de 2026-09-09)**

O combo `smart` guarda `classifier.confidenceThreshold`, `classifier.timeoutMs` e
`classifier.model` no `routing`. Os três saíram da tela
(`/dashboard/combos/[id]`) e só se editam por `PUT /api/combos/{id}`. Motivo:
são tuning que ninguém calibra sem telemetria, o servidor já os clampa contra
um default (`router.ts:71-73`), e `task.confidenceThreshold` nunca teve UI — a
tela agora é consistente com esse precedente em vez de expor três campos
numéricos ao lado do único controle que é escolha real, o switch
`classifier.enabled`. Valor diferente do default aparece como texto no card
"O que o sistema decide sozinho", para que uma config ajustada por API não fique
invisível.

Na mesma leva, `overrides.general.default` deixou de ser editável: era o mesmo
balde que o router já preenche a partir de `combo.models`
(`mergeLegacyModels`, `router.ts:207-208`), ou seja, dois editores para um
campo. `combo.models` é estritamente mais amplo — vale no need classificado
**e** no do endpoint — então ele sobreviveu como a lista "Sempre considerado" e
configs antigas são dobradas nele por `foldGeneralDefaultIntoGlobals`.

**Aguardando um segundo caso**: `tunnelProvider` só tem um provider implementado
(`cloudflare`); um seletor de um item é ruído. Adicionar quando houver o segundo.

**Tinha UI faltando, corrigido**: `freeFallbackEnabled` mudou *para onde o prompt
do usuário vai* quando as contas esgotam e não tinha controle nenhum. Hoje está
em `profile/sections/RoutingCard.tsx`.

A regra: uma chave sem UI **documentada como decisão** não é gap. O gap era não
saber a diferença.

## Quem pediu uma escrita: o caminho, não o corpo

As três escritas governadas do harness — skill, memória e toggle de plugin —
decidiam entre "operador" e "agente" por um campo do corpo da requisição
(`initiator` / `source`). Nada corroborava, e no caso de skill o default era o
lado *sem* gate: `body.initiator === "agent" ? "agent" : "user"`. Ou seja, o
gate de aprovação estava a um executor esquecido de virar decoração — bastava
uma ferramenta nova espalhar os argumentos do modelo no corpo.

Hoje as duas origens chegam por caminhos diferentes e cada caminho responde por
si:

- skill: `PUT /api/harness/skills` é sempre do operador (o editor do
  dashboard); `PUT /api/harness/skills/agent` é sempre do agente. Ambos chamam
  `applySkillWrite(request, initiator)`.
- memória: `PUT` é do operador, `POST` é do agente e fixa `source: "agent"`.
- governança: `POST` é do agente e fixa `source: "agent"`.

Nenhum dos quatro handlers lê o campo do corpo. O modelo só alcança o harness
através dos nossos executores, então não consegue escolher o outro caminho — o
que um rótulo no corpo nunca garantiu. Um XSS no dashboard continua fora do
alcance deste gate, e sempre estará: ali o atacante é o próprio principal.

## Toda page carrega `<MetadataIsDynamic />`

O `generateMetadata` do root layout traduz o `<title>` a partir do cookie de
locale, porque o tradutor de runtime só reescreve o que está sob
`document.body` — a aba do navegador ficava em inglês. Isso torna a metadata de
**toda** rota dependente da requisição, e o Cache Components se recusa a inferir
que uma rota cuja *metadata sozinha* difere é intencional: normalmente é
descuido. Ele pede que a intenção seja renderizada na árvore.

Por isso `src/app/metadataIsDynamic.tsx` existe e por isso ele aparece em cada
`page.tsx`. Duas coisas que custaram medição e valem estar escritas:

- **Um marcador no layout não satisfaz a checagem.** Testado no 16.3.2 com uma
  rota descartável: com `<Suspense><connection /></Suspense>` no `RootShell` o
  insight continua idêntico; movido para a page, some. A doc do Next diz "on the
  page" e diz literalmente.
- **O insight dispara na navegação client, não no load direto.** `curl` da rota
  não reproduz e o console do dev server não imprime nada; ele aparece no
  overlay ao navegar de uma rota para outra. É por isso que ele passou
  despercebido até alguém clicar no menu.
- **`export const instant = false` isenta só o segmento que o exporta.** O do
  root layout nunca cobriu as rotas filhas — a doc do Next é explícita
  ("Descendant segments are still validated by the global default"). É a mesma
  suposição errada do item acima: uma declaração no layout não desce, e cada
  rota é validada por conta própria.

O `npm run build` passa sem o marcador — é validação de desenvolvimento, não
quebra produção. E uma page que esquecer o marcador não fica quebrada em
silêncio: o overlay nomeia a rota na próxima navegação até ela.

Duas pages ficam de fora, cada uma por um motivo:

- `src/app/page.tsx` só faz `redirect()` e nunca renderiza metadata.
- `src/app/callback/page.tsx` é `"use client"` — um Server Component não entra
  ali, e ela é alcançada por redirect externo (load direto), não por navegação.

## Nenhuma page espera dado acima do `<Suspense>`

Corolário do item acima: como o `instant = false` do root layout não desce,
toda rota tem que se defender sozinha. A forma é sempre a mesma — o componente
de página é **síncrono** e só monta a boundary; quem espera é o componente de
conteúdo abaixo dela:

```tsx
export default function Page({ params }: PageProps<"/rota/[x]">) {
  return (
    <>
      <Suspense fallback={<Spinner … />}><Conteudo params={params} /></Suspense>
      <MetadataIsDynamic />
    </>
  );
}
```

Isso vale para `await params`, `assertRequestRuntime()`, `withTenantPage()` e
qualquer leitura de banco — e `notFound()` / `redirect()` vão junto, para dentro
da boundary. O shell que sobra não é vazio: o chrome do `DashboardLayout`
(sidebar, header, título) prerenderiza e só a região de dados streama, que é
exatamente o que a doc do Next pede em "push the boundary as low as possible".

Cinco pages estavam com o `await` no topo — `cli-tools`, `cli-tools/[toolId]`,
`endpoint`, `combos/[id]` e `media-providers/[kind]/[id]` — e foram convertidas.
A varredura que mostra se alguma voltou a espetar um `await` acima da boundary é
direta: `await ` dentro do bloco `export default` de um `page.tsx`.

## O escopo de tenant não atravessa um `<Suspense>`

`withTenantPage` entra num `AsyncLocalStorage` pela duração do callback. O que o
callback **espera** está dentro; o que o React renderiza **depois** não está —
ele retoma um filho suspenso sob um snapshot de contexto capturado antes do
escopo existir. Então isto compila, passa no build e estoura
`TenantContextError` em toda visita:

```tsx
return withTenantPage(async () => <Suspense><LêTenant /></Suspense>);
```

O próprio `withTenantPage` documenta a mesma armadilha para `enterWith()`. O que
faltava estar escrito é que um `<Suspense>` entre o `run()` e a leitura a
reabre. A forma que funciona — a que `combos`, `providers`, `proxy-pools` e as
outras listagens já usam — põe o `withTenantPage` **dentro** do componente que
fica sob a boundary, onde o escopo cobre a leitura que precisa dele.

`/dashboard/media-providers/[kind]` foi assim desde `0b72819e` e ninguém tinha
aberto a rota. Nada na suíte notava: o tipo fecha, o build passa, e o erro só
existe em runtime. Hoje `tests/unit/tenantSuspenseScope.test.ts` recusa a forma
— falha nomeando o arquivo.

## Motor de decisão: heurística ou Jev

`settings.decisionEngine` escolhe quem toma as decisões pequenas da plataforma:
as heurísticas de sempre (padrão) ou o **Jev** (TypeSafe AI), um modelo que
responde perguntas tipadas — `boolean`, `choice`, `score` — com probabilidade
calibrada, e não gera texto. Cada uso tem sua flag (`jevSmartRouting`,
`jevMemoryReview`, `jevPluginSelection`, `jevWriteRisk`), editável no card
"Motor de decisão" do perfil.

Três regras que valem para todos os usos, e que um uso novo tem que seguir:

- **Jev nunca é a única resposta.** `evaluateJev` (`src/server/decisions/jev.ts`)
  não lança: sem chave, timeout, não-2xx ou formato desconhecido viram `null`,
  e o chamador segue com a heurística que já tinha. O Jev melhora uma decisão
  que já existia; nunca é o que faz uma requisição falhar.
- **A chave é a da conexão `vercel-ai-gateway`.** O Jev é chamado pela Vercel
  AI Gateway (`POST https://ai-gateway.vercel.sh/v1/evaluate`, modelo
  `typesafe-ai/jev`), então a credencial é a mesma conexão que já serve os
  modelos da gateway — por conta, criptografada, criada pelo mesmo
  validate-then-create da tela de providers. Não existe segunda chave nem
  fallback para uma chave da plataforma: o custo é da conta do usuário.
- **Jev não aprova nada.** O `score` de risco das escritas pendentes
  (`queuePendingWrite`) é gravado ao lado da escrita e mostrado ao operador;
  nada o lê para decidir. O gate de aprovação continua do operador.

Onde cada uso mora:

| Flag | Onde | Substitui |
|---|---|---|
| `jevSmartRouting` | `llm-gateway/application/routingClassifier.ts` → `resolveSmartRouting` | o classificador LLM, quando a confiança do Jev passa o `confidenceThreshold` |
| `jevMemoryReview` | `harness/learning/postTurnReview.ts` | as regex de "remember/lembre-se" |
| `jevPluginSelection` | `harness/tools/toolSelection.ts`, chamado pelo worker de `durableRun` | mandar todas as `tools` da conversa (só remove com p < 0.1) |
| `jevWriteRisk` | `harness/governance/queuePendingWrite.ts` | nada — é informação nova na fila de aprovação |

O classificador do roteamento inteligente existia em dois arquivos quase
iguais (`smartRoutingClassifier.ts` e `routingClassifier.ts`); ligar o Jev
num só deixaria metade dos endpoints sem ele. Hoje todos passam por
`smartRoutingClassifiers(request, apiKey, handleSingleModelChat)`.

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

## Verificação ao vivo das runs duráveis

`tests/unit/durableRunLive.test.ts` é o único teste que toca o banco real e um
provider real. Fica pulado por padrão — gasta cota e precisa de `DATABASE_URL` —
e existe porque o resto da suíte mocka pelo menos uma ponta, que foi como o
fluxo de runs duráveis chegou quebrado ao usuário duas vezes: cada peça estava
provada contra um stub.

```bash
NODE_OPTIONS="-r dotenv/config" DOTENV_CONFIG_PATH=.env \
  LIVE_RUN=1 \
  LIVE_RUN_USER=<uuid da conta> \
  LIVE_RUN_MODEL=<modelo> \
  LIVE_RUN_KEY=<api key da conta> \
  npx vitest run tests/unit/durableRunLive.test.ts
```

`LIVE_RUN_KEY` é necessário quando a conta tem `requireApiKey` ligado, e tem que
ser uma chave **da mesma conta**: o worker só repassa uma que consiga provar que
o chamador possui. Sem ela a run settla como `failed: Missing API key`, que é o
gate funcionando, não uma quebra.

## Erros conhecidos

**`npm ci` falha no CI com "Missing: ... from lock file".** O workflow já
explica a forma do problema — o npm no Windows nunca instala os pacotes
específicos de plataforma, então nunca valida aquela subárvore e dá o lockfile
como em dia, enquanto o `npm ci` no Linux valida a árvore inteira e recusa. O
que faltava é a receita, porque a correção óbvia não funciona:

```bash
# NÃO resolve. Produz zero diff, no Windows e no Linux.
npm install --package-lock-only --include=optional
```

O npm 11 considera o lockfile completo sem essas entradas e se recusa a
escrevê-las, mas o `npm ci` dele — que é o que o workflow instala — exige.
Quem escreve as entradas é o npm 10:

```bash
npx -y npm@10.9.2 install --package-lock-only --include=optional
npx -y npm@10.9.2 ci --dry-run --include=optional   # confirma antes de commitar
```

Confira que o resultado é aditivo comparando os dois lockfiles campo a campo
(versões alteradas, entradas removidas), nunca pelo tamanho do diff — 400
linhas novas de dependência opcional são benignas, uma versão alterada não é.

O commit `e3965291` atribui isso a uma diferença de versão entre o npm local e
"o npm que vem com o Node 22" no CI. Está errado: o workflow instala `npm@11`
explicitamente. A diferença é entre o que o npm 11 *escreve* e o que ele
*valida*, e o npm 10 é a ferramenta que fecha essa lacuna.

**O `next dev` responde 404 em todas as rotas.** Sintoma observado depois de
rodar `npm run check` com o dev server no ar. A suspeita registrada era que o
`next build` do check escreve um `.next` de produção por cima do que o
`next dev` mantém ali.

**Isso não se reproduziu quando foi medido (2026-09-10).** Com um único
`next dev` na porta 3000, um `npm run build` completo por cima dele: o dev
continuou respondendo 200. O que de fato produziu os 404 foi outra coisa —
**dev servers acumulados**. O `next dev` não falha quando a porta está ocupada,
ele avisa e sobe na próxima livre:

```
⚠ Port 3000 is in use by process 42088, using available port 3001 instead.
```

Então cada tentativa de "reiniciar" deixa o processo velho na 3000 e coloca o
novo na 3001, 3002… O navegador continua apontando para a 3000 e recebe as
respostas do servidor antigo, num estado que não corresponde mais ao código —
inclusive 404 em tudo. Reiniciar parece não resolver porque o que responde
nunca foi reiniciado.

Diagnóstico antes de qualquer outra coisa: **veja quem está na porta.**

```bash
netstat -ano | grep ":300[0-9].*LISTENING"   # um PID por porta
taskkill //PID <pid> //F                      # mate o que está na 3000
npm run dev                                   # confirme "Local: http://localhost:3000"
```

Se a linha `Local:` do dev server não disser 3000, você está testando um
servidor diferente do que o navegador está lendo.

`NEXT_DIST_DIR=.next-check` **não** resolve — o ESLint passa a varrer o
diretório novo e o passo de lint falha com centenas de erros no output do build.

**O `typecheck` falha em `.next/dev/types/validator.ts` com o dev server no ar.**
Erros de sintaxe (`TS1005`, `TS1002 Unterminated string literal`) num arquivo que
ninguém escreveu à mão: o `next build` do check e o `next dev` geram tipos ao
mesmo tempo e o arquivo sai com linhas entrelaçadas — `const handler = {} as
typeof import("…/route") type __Unused = __Check` numa linha só. Não é o código
da mudança, e rodar o check de novo não limpa, porque o build de produção escreve
`.next/types` e nunca reescreve `.next/dev/types`. `rm -rf .next/dev/types` antes
do check resolve; o dev server regenera.

## O que pertence à conversa e o que pertence à conta

Uma "sessão" é uma conversa. A regra que faltava estar escrita:

**Da conversa** (vive em `ChatSession`, sincroniza, segue o usuário entre
dispositivos): `systemPrompt`, `temperature`, `reasoningEffort`, `mode`,
`agentPresetId`, `pluginOverrides`, `skillOverrides`, `pluginSettings`,
`mcpServers`, e as mensagens.

Os três primeiros eram estado de página numa chave única de `localStorage`,
ao lado — no mesmo diálogo — de configurações que já eram por conversa. Subir
o esforço numa conversa subia em todas, e nada disso sobrevivia a uma troca de
navegador. Configs antigas são dobradas na conversa aberta na hidratação.

**Da conta** (compartilhado por todas as conversas, de propósito): a memória do
agente e do usuário, o catálogo de skills, a composição de plugins e a config
de aprendizado. A memória é o ponto do produto — é o que deixa o assistente
lembrar do usuário de uma conversa para outra. A UI diz isso em texto, porque
o contexto visual sugeria o contrário.

**Deste navegador, nunca sincronizado**: rascunhos e anexos não enviados
(`useSessionDrafts`), chaveados por conversa. Não entram em `ChatSession` de
propósito: sincronizá-los mexeria no `updatedAt`, que é o que decide
precedência de sync.

**Da página, e corretamente**: `isSending` — o cliente roda um envio por vez.
Mas nenhum controle de conversa deve lê-lo: eles leem `isBusy`
(`isSending && sendingSessionId === activeSessionId`). Ler `isSending` direto
punha "Parar" em toda conversa, e pará-la numa conversa parada matava o run de
outra.

## O gate de capacidade é do servidor

Duas perguntas diferentes, e só uma tinha resposta no servidor:

- **quem pediu?** (operador ou agente) — resolvido pelo caminho, nunca pelo
  corpo, com teste de regressão (`memoryRoute.test.ts`). Ver a seção acima.
- **esta conversa pode?** (o plugin está ligado) — não existia fora do browser.
  `serverToolLoop` derivava as ferramentas permitidas do `body.tools` que o
  cliente postou, então qualquer coisa capaz de postar um run escrevia na
  memória compartilhada da conta com o plugin desligado.

`sessionHasPlugin` resolve a segunda a partir da conversa persistida e da
composição de plugins da conta — mesmo padrão do alvo MCP, que nunca vem do
chamador. Aplicado no executor do worker e nas rotas `POST /api/harness/memory`
e `/api/harness/governance`. Teste: `serverPluginGate.test.ts`.
