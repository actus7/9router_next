# Synapse Loop — o Synapse que aprende

**Data:** 2026-09-28
**Status:** Implementado (fases 1–3 juntas: ciclo automático, rollback, Jev) — 2026-09-28

## 1. O que é

Hoje o Synapse responde localmente, sem chamar o modelo, a um conjunto fixo de
padrões pt-BR/en (saudação, agradecimento, despedida). O Loop faz o conjunto
crescer sozinho: uma pergunta que a conta repete, cuja resposta não depende de
contexto nem de tempo, vira uma **competência** que o Synapse passa a responder
— custo zero, latência de milissegundos.

A tese é a do projeto original ([actus7/synapse](https://github.com/actus7/synapse)):
*o LLM paga o custo cognitivo de um problema uma vez só*. A regra de ouro também:
**falso positivo que engole uma pergunta real é pior do que gastar tokens.**

## 2. Por que não é um port

O original foi lido inteiro (HEAD `ab762c7`). A ideia é boa; a implementação
não serve de base, e cada item abaixo é uma decisão deste desenho:

| No original | Consequência | Aqui |
|---|---|---|
| Competências **globais**, template = resposta do LLM a *um* usuário | resposta com dados de A servida a B | **por conta**, sempre (`userId`, como toda tabela) |
| Precisão do shadow = "alguma competência ativa também respondeu" | intenção nova nunca promove (precisão 0) | precisão = **a resposta que teria dado equivale à que o LLM deu** |
| Cluster = igualdade exata do texto normalizado | memorização, não generalização | igualdade exata no modo básico; **Jev agrupa por intenção** no avançado |
| Rollback por qualquer frase de preferência até 5 min depois | ruído deprecia competências boas | rollback pelo **👎 e pelo "Regenerar"** do chat — sinal explícito sobre *aquela* resposta |
| Input e resposta crus guardados sem retenção | privacidade | observação com **TTL de 30 dias**, desligável, e só de turnos elegíveis |
| Observer em cron (Inngest) | dependência nova | **incremental na escrita**: não há batch |
| fallbackRate contado em dobro, taxa de clarificação sempre nula | métricas falsas | métricas derivadas das próprias tabelas, com teste |

## 3. Elegibilidade — o que pode ser aprendido

Um turno só é **observado** quando o Synapse já o consideraria (mesmas guardas
de `trySynapseIntercept`): última mensagem do usuário, sem atividade de tool no
histórico, sem tool forçada, uma frase, ≤ 120 caracteres normalizados, e o
assistente não acabou de fazer uma pergunta. Mais três, específicas do Loop:

- **sem system prompt de persona** (a resposta dependeria dele) — o bloco de
  memória/skills do chat não conta como persona; uma chave de hash do system
  prompt vira parte da chave da competência, então personas diferentes nunca
  compartilham resposta;
- **a resposta é estável**: não depende de hora, data, preço, clima, notícia,
  do histórico ("e o segundo?") nem de dado pessoal. Heurística: regex pt/en de
  termos temporais/pessoais + pronome anafórico no input. **Com Jev**: uma
  pergunta `score` "quão dependente de contexto/tempo/pessoa é esta resposta?";
- **a resposta é curta** (≤ 1.500 caracteres) e **sem tool call**.

## 4. Modelo de dados (aditivo, `schema.ts`)

```
synapseObservations  userId, id, key, input, answer, model, personaHash, createdAt
                     — TTL 30d; key = normalize(input) (+ intentId no modo Jev)
synapseCapabilities  userId, id, key, personaHash, canonicalInput, answer,
                     status (candidate|shadow|active|rejected|deprecated),
                     shadowRuns, shadowAgreements, served, rejections,
                     source (heuristic|jev), createdAt, updatedAt
synapseEvents        userId, id, capabilityId, type, payload, createdAt
                     — shadow_evaluated | served | rejected | promoted | deprecated
```

Índice único `(userId, key, personaHash)` em `synapseCapabilities`: a busca em
runtime é **uma leitura por chave**, não a tabela inteira (o original lia todas
as competências a cada turno).

## 5. Ciclo de vida

1. **Observar** — após uma resposta do LLM a um turno elegível, grava a
   observação (fora do caminho da resposta, em `waitUntil`).
2. **Candidata** — na mesma escrita: ≥ 2 observações com a mesma chave em 30
   dias **e** respostas equivalentes entre si → cria `candidate` com a resposta
   mais curta. Respostas divergentes para a mesma pergunta = a pergunta não é
   estável; não cria.
3. **Shadow** — automático (não afeta o usuário). A cada turno que casa com uma
   competência `shadow`, o LLM responde normalmente e, depois, compara-se a
   resposta que o Synapse *teria dado* com a real: `shadowRuns++`, e
   `shadowAgreements++` se equivalem.
   - Equivalência heurística: similaridade de tokens ≥ 0,8 após normalizar.
   - **Com Jev**: `boolean` "estas duas respostas dizem a mesma coisa ao usuário?".
4. **Aprovação** — com `shadowRuns ≥ 10` e `agreements/runs ≥ 0,9`, a
   competência entra na **fila de aprovação do operador que já existe**
   (`queuePendingWrite`, aba Aprendizado), mostrando pergunta, resposta e
   números. Aprovar → `active`. (Opção de autoaprovação na §9.)
5. **Servir** — `active` e a chave casa → resposta local, pill "Synapse ·
   aprendido" abaixo da mensagem, `served++`.
6. **Rollback** — 👎 ou "Regenerar" numa resposta servida pela competência →
   `rejections++`; ≥ 2 rejeições ou taxa > 10% → `deprecated`, sai da fila de
   uso na hora. O operador pode reativar.

## 6. Runtime — onde entra no gateway

Em `trySynapseIntercept`, depois dos padrões fixos e com as mesmas guardas:
`lookupCapability(userId, key, personaHash)` — memo por processo com TTL curto,
como o `getSettings`. **Com Jev**, quando não há chave exata: uma pergunta
`choice` "esta mensagem pede qual destas competências (ou nenhuma)?" sobre as
≤ 20 competências ativas mais próximas por FTS (`tsvector` já em uso), aceita só
com confiança ≥ 0,9. Jev é sempre opcional: sem chave ou com falha, só a chave
exata vale (regra de `docs/CONVENTIONS.md`: "Jev nunca é a única resposta").

O shadow e a observação rodam após a resposta, nunca antes: o Loop não pode
acrescentar latência a um turno que vai para o LLM.

## 7. Configuração (UI no card do Synapse, página Economizador)

- `synapseLearningEnabled` — **desligado por padrão** (guarda dados de conversa).
- `synapseLearningAutoApprove` — desligado por padrão; ligado, pula o passo 4.
- Modo avançado = `decisionEngine: "jev"` + nova flag `jevSynapse` no card
  "Motor de decisão" (mesmo padrão das quatro flags que já existem).
- Lista das competências da conta: status, pergunta, resposta, runs/acertos,
  servidas, rejeições; ações aprovar / rejeitar / depreciar / reativar / apagar.
- Botão "Esquecer tudo que o Synapse aprendeu" (apaga as três tabelas da conta).

## 8. Fases

1. **Observação + candidatas + chave exata + aprovação manual** (sem shadow:
   candidata vai direto para a fila de aprovação com as observações como
   evidência). Já economiza tokens e prova o fluxo ponta a ponta.
2. **Shadow + promoção por evidência + rollback pelo 👎/Regenerar.**
3. **Modo avançado Jev**: estabilidade, equivalência, casamento por intenção.
4. **UI de métricas** e o teste ao vivo (`xiaomiGatewayLive`-style) do ciclo
   inteiro: observar → candidata → aprovar → servir → rejeitar → depreciar.

Cada fase termina com `npm run check` verde e um teste ao vivo contra provider
real — o Loop atravessa gateway, worker e UI, exatamente o tipo de fluxo que
`CONVENTIONS.md` registra ter chegado quebrado com a suíte verde.

## 9. Decisões do operador (2026-09-28)

1. **Flag ligada = aprendizado e aprovação automáticos.** Não há fila humana:
   a competência nasce direto em `shadow` e vira `active` sozinha quando a
   evidência do §5 passa. A segurança é a evidência, não um clique.
2. **Retenção**: 30 dias.
3. **Escopo**: chat **e** API. Como a API não tem 👎, o rollback ganha uma
   **auditoria por amostragem**: 1 em cada 20 turnos que uma competência
   `active` serviria vai ao LLM mesmo assim, e a resposta real é comparada com a
   da competência — divergência conta como rejeição (§5, passo 6). No chat, 👎
   e "Regenerar" também contam.
4. **Jev**: com o motor de decisão em `jev` e a chave da conta, o Jev decide em
   **todo** ponto onde há uma decisão — roteamento de modelos, revisão de
   memória, seleção de plugins, risco de escrita e todo o Loop (estabilidade,
   equivalência, casamento por intenção). Todas as flags `jev*` passam a vir
   ligadas por padrão; os switches ficam só para desligar um uso. Sem chave, com
   falha ou timeout, vale a heurística.

Consequência para o §5: o passo 4 (aprovação humana) sai; `synapseLearningAutoApprove`
do §7 deixa de existir — a própria `synapseLearningEnabled` é a autoaprovação.
