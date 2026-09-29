# Perfis por origem: habilidades e skills por API key e por conversa

**Data:** 2026-09-29 · **Status:** implementado

## Problema

A página "Economizador de Tokens" gravava RTK, Caveman, Ponytail, Synapse,
pxpipe e MetaBreak numa linha única de `settings`, e
`buildChatCoreOptions` (`llm-gateway/application/chat.ts`) lia essa linha para
**toda** chamada — do chat e da API. Ligar o Caveman para um cliente de API
mudava o chat, e não havia como uma chamada de API receber skills.

## Decisão

O que o gateway faz a uma requisição além de roteá-la é um `GatewayProfile`
(`src/shared/gateway/gatewayProfile.ts`): `abilities` (as seis habilidades e
seus níveis) e `skillIds`. O perfil vem **de onde a requisição veio**, nunca do
corpo:

| Origem | Quem abre o escopo | De onde vem o perfil |
|---|---|---|
| API pública | `gatewayRoute`, com o `id` da chave já resolvido | `apiKeys.profile` (JSON) |
| Chat (run durável) | `startDurableRun`, em volta da run inteira | `pluginSettings.abilities` da conversa gravada |
| Chamador interno sem escopo | ninguém | `settings` (comportamento de antes) |

O escopo é um `AsyncLocalStorage` (`llm-gateway/application/gatewayProfile.ts`).
O escopo do chat vence o da chave: o worker pode repassar uma chave da conta
(`requireApiKey`), mas quem decide as habilidades de um turno de chat é a
conversa.

### D1 — Skills na API vão com o corpo inteiro

No chat, skills entram como descrição mais a ferramenta `load_skill`, que o
harness responde. Na API quem executa ferramentas é o cliente, e o gateway não
pode responder a uma chamada que o cliente não declarou. Então a chave que
seleciona uma skill recebe o SKILL.md inteiro no system prompt de toda
requisição (`buildGatewaySkillsPrompt`). O modal de Skills mostra o custo
estimado. O bloco de skills não obedece ao header de opt-out
`x-modelhub-token-saver: off` — não é um economizador, a chave pediu.

### D2 — Migração preguiçosa

`apiKeys.profile` é aditiva e começa `NULL`. `NULL` lê como as flags de
`settings`, então nenhuma chave existente muda de comportamento sem ser editada.
Chave nova nasce com uma cópia escrita de `settings`. `settings` continua com as
flags como molde de chaves novas e como padrão de conversa que nunca ajustou as
habilidades.

### D3 — O que continua da conta

As respostas aprendidas pelo Synapse Loop (revisadas no card "Respostas
aprendidas" do Endpoint), o catálogo de skills instaladas (a chave só escolhe),
e o tuning global (`pxpipeMinChars`, headroom, observabilidade). O **switch** de
aprendizado passou a ser por chave e por conversa.

### D4 — Skills no chat não mudaram

Continuam por conversa com as preferências globais. `sessionGatewayProfile`
devolve sempre `skillIds: []`, para o chat não receber os corpos inteiros além
das descrições.

## Onde mora cada coisa

- Tipo, normalização e leitura de `settings`: `src/shared/gateway/gatewayProfile.ts`
- Escopo e resolução preguiçosa: `src/server/llm-gateway/application/gatewayProfile.ts`
- Injeção das skills: `gatewaySkills.ts` + passo em `runTokenSavers` (`chatCore/phases.ts`)
- Perfil da conversa: `src/server/harness/tools/sessionGatewayProfile.ts`
- Repo: `getApiKeyProfile` / `updateApiKeyProfile` em `apiKeysRepo.ts`
- API: `GET/PUT /api/keys/[id]/profile`
- UI: `AbilitiesEditor` (compartilhado), `KeyAbilitiesModal`, `KeySkillsModal`
  e `LearnedAnswersCard` no Endpoint; `ChatAbilitiesPanel` na aba de
  configuração de plugins do chat.
- `/dashboard/token-saver` redireciona para `/dashboard/endpoint`.

## Limites conhecidos

- A conversa sincroniza com debounce de 350 ms. Mudar uma habilidade e enviar
  dentro dessa janela roda o turno com o valor anterior — mesmo contrato de
  `sessionHasPlugin`.
- O executor de ferramentas do navegador (fallback, fora do caminho durável)
  delega subagentes pela API pública com a chave da conta, e portanto com o
  perfil da chave.
- A UI do pxpipe continua desligada (`PXPIPE_UI_ENABLED` antigo): o campo
  existe no perfil, sem controle na tela.
