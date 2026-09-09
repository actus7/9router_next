# Duck.ai: diagnosticar quando parar de funcionar

Duck.ai é integração **não-oficial**. O DuckDuckGo não publica contrato, não versiona
nada e defende o endpoint contra automação. Ele vai quebrar de novo — a pergunta útil
não é como evitar, é como gastar 15 minutos em vez de horas no conserto.

Este documento existe porque a quebra de 2026-09-09 custou horas por falta dele.

## O sintoma e a armadilha

`POST /duckchat/v1/chat` responde `418 ERR_CHALLENGE`, o executor tenta 5 vezes e
devolve 503. O log mostra o challenge sendo **resolvido com sucesso** a cada tentativa
(`phase:"vqd"`, `finalOutcome:"success"`) e o chat recusando logo depois.

A armadilha: **o DuckDuckGo valida o corpo antes do challenge.** Um corpo inválido
responde `400 ERR_BAD_REQUEST` sem sequer olhar o hash. Então enquanto o 418 estiver
de pé você não enxerga os erros de corpo atrás dele, e ao consertar o challenge o
sintoma *muda* para 400 — o que parece regressão e não é: é progresso.

Em 2026-09-09 havia quatro divergências simultâneas, duas de challenge e duas de corpo.

## O procedimento que resolve

Não tente adivinhar o que mudou. **Capture o request do app real e compare campo a
campo.** Foi só isso que funcionou.

1. Abra `https://duck.ai/` no Chrome com o DevTools no painel Network.
2. Mande uma mensagem qualquer pela UI.
3. Ache o `POST duck.ai/duckchat/v1/chat` e copie os request headers e o body.
4. Compare com o que `sendDuckAiChatRequest` monta (`duckaiRequest.ts`).
5. Alinhe as diferenças uma a uma, testando ao vivo a cada mudança.

Com o `chrome-devtools` MCP ligado dá para fazer isso sem sair do Claude Code:
`navigate_page` → `fill`/`click` → `list_network_requests` → `get_network_request`.

### Cuidado com o CAPTCHA

Muitos challenges falhados seguidos marcam o IP, e aí **o próprio app do DuckDuckGo
passa a levar 418**. Nesse estado nada é diagnosticável: você não consegue distinguir
"nosso request está errado" de "este IP está bloqueado". O sinal é o app first-party
falhando no navegador.

Para destravar: abra o duck.ai e resolve o CAPTCHA (selecionar os patos) manualmente.
Só depois volte a testar.

## O que o app manda e é fácil esquecer

Capturado do cliente real em 2026-09-09.

### Header `x-fe-version`

Obrigatório. O challenge é validado contra ele. Sai do `<html>` da página:

```html
<html data-version-tag="serp_20260909_143633_ET"
      data-version-sha="dc59730c41b9e3a57d9a2783fdfb007ec00a2a15">
```

Concatenados com `-`. Resolvido em runtime por `fetchDuckAiFrontend()`, cache de 1h.

### Campos extras em `meta`

O script do challenge devolve só `v`, `challenge_id`, `timestamp` e `debug`. O cliente
acrescenta três antes de submeter, e o upstream cobra:

| campo | valor |
|---|---|
| `origin` | `https://duck.ai` |
| `duration` | ms que a resolução levou |
| `stack` | Error stack apontando para o bundle `entry.duckai.<hash>.js` |

O nome do bundle também sai do HTML da página.

### Formato do corpo

- `messages[].content` é **array de parts** (`[{type:"text",text}]`), não string
- `reasoningEffort` vai **sempre**; `"none"` para modelos sem modo de raciocínio
- `canShowGreeting: true` e `canDelegateImageGeneration: null` estão presentes

## O que já foi descartado

Não gaste tempo nestes de novo sem evidência nova:

- **User-Agent desatualizado.** Medido contra o Chrome real: idêntico. O comentário em
  `duckaiChallengeTypes.ts` sobre major version velha é real, mas não foi a causa aqui.
- **`signals: {}` vazio.** É literal no script do próprio DuckDuckGo, não falha nossa.
- **jsdom produzir hash errado.** Rodando o mesmo `challenge_id` nos dois ambientes há
  divergência pequena (medida: −4 e −1 em dois probes), mas o hash do jsdom **é aceito**.
  Trocar o solver por um browser real não resolve nada e custa a dependência.

## Verificar ao vivo

Um teste temporário em `tests/` (o vitest resolve os aliases) chamando `getVqdData()` e
`sendDuckAiChatRequest()` direto fecha o ciclo em segundos. `200` com um SSE
`{"action":"success",...}` é a prova. Apague o arquivo depois — não commite teste que
bate em rede.
