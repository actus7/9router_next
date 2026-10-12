# Parâmetros e conta por entrada do combo smart

Status: Fases 1–3 implementadas (2026-10-12). Pendente apenas verificação ao vivo (ver "Pendências"). Referência de produto: `mnfst/llm-gateway` (MIT) — `docs/model-parameters-schema.md`, `packages/shared/src/{provider-params-spec,request-params,model-params-scope}.ts`, `ModelParamsDialog.tsx`.

## O que se quer

1. Em cada entrada de uma lane do combo smart, abrir um diálogo **Parâmetros** com os controles que aquele modelo realmente aceita (GLM: `max_tokens`, `do_sample`, `temperature`, `top_p`, `reasoning_effort`, `thinking.type`, `response_format.type`; GPT: `reasoning.effort`, `reasoning.summary`, `text.verbosity`…).
2. Em cada entrada, escolher **qual conta** do provider atende (dropdown quando há mais de uma conexão), podendo repetir o mesmo modelo com contas diferentes e ordenar à vontade.
3. Solução **genérica**: nenhum provider ganha código próprio de parâmetros.
4. "Sugerir modelos" passa a considerar essas características.

## Estado atual (verificado)

- Entrada de lane é `string` (`routing.overrides[need][tier]: string[]`, `smart-routing/types.ts:42`; `combo-types.ts:13`). Não há parâmetros nem conta por entrada.
- Nada da UI do print existe em `src/`; `ComplexityRoutingBoard.tsx` só reordena, troca e remove.
- Há um strip de parâmetros por provider escrito à mão (`translator/concerns/paramSupport.ts`) — é o oposto de genérico e continua valendo como rede de segurança.
- A sugestão (`suggestProfiles.ts` → `assignLanes`) é por regras sobre o Artificial Analysis, sem LLM (decisão de 2026-10-03, ver `CONVENTIONS.md`). Esta feature a estende; não reintroduz LLM.
- O combo já carrega estado por tentativa no body por símbolo (`setPerfKey`, `setAttemptSignal`); é o canal para conta e parâmetros.

## Desenho

### 1. Catálogo genérico: pacote `modelparams`

Dependência `modelparams` (MIT, ~3,9 MB, só servidor). Cada entrada descreve `provider/authType/model` e uma lista de `params`: `path` (dot path), `type`, `label`, `description`, `default`, `values`, `range{min,max,step}`, `group`, `applicability{only|except}`. Isso é exatamente o que os prints mostram, para todos os providers, sem código por provider.

- `src/shared/llm-catalog/paramSpecs.ts` (server-only): `getParamSpecs(providerId, authType, model)` com normalização de id/alias do nosso registry para o do catálogo. **Sem spec = sem botão de parâmetros**; nunca inventar controles.
- Sem refresh ao vivo no início (a referência faz fetch horário em `modelparams.dev`). Versão do pacote fixa; atualizar é um bump. Refresh ao vivo só se houver necessidade medida.
- UI recebe os specs por rota (`GET /api/model-params/specs?model=…`), nunca importa o pacote no bundle do cliente.

### 2. Dados: entrada de lane vira `string | { model, connectionId?, params? }`

- `normalizeRoutingConfig` aceita os dois formatos e **grava string quando não há configuração** — combos existentes não mudam de forma.
- `params` guarda valores de UI no mesmo shape do `path` do spec (`{"reasoning.effort":"xhigh"}`), validados contra o spec (tipo, `range`, `values`) no servidor. Chave desconhecida é rejeitada, não ignorada em silêncio.
- A mesma entrada pode aparecer duas vezes na lane com `connectionId` diferente (print 5). A identidade da entrada é a posição na lane, não o modelo.
- `connectionId` pertence à conta do tenant: validado contra `providerConnections` do dono (nunca vem cru do corpo — mesmo princípio de "o caminho, não o corpo").

### 3. Gateway

- O router devolve, além de `candidates: string[]`, um `entryConfig` por candidato. O combo coloca `{connectionId, params}` no body da tentativa por símbolo (como `setPerfKey`).
- **Conta**: `getProviderCredentials` ganha um `onlyConnectionId`. Conta fixada indisponível/em cooldown = a tentativa falha e o combo segue para o próximo candidato (que pode ser o mesmo modelo noutra conta). Fixar nunca faz rotacionar para uma conta que o usuário não escolheu.
- **Parâmetros**: aplicados antes do translator com a semântica da referência — valores configurados vencem os do cliente nos paths que configurou, o resto do body do cliente fica, e o que é inaplicável sob os valores finais (`applicability`) é omitido. Só se aplica quando a requisição passou pelo combo; pedido que nomeia o modelo direto pula (é o que o texto do diálogo promete).
- `paramSupport.ts` continua depois, como rede de segurança contra 400 de provider.

### 4. UI (`ComplexityRoutingBoard`)

- Botão de ajustes por linha (destacado quando há valor definido, como no print) abrindo o diálogo gerado do spec: grupos `generation_length`, `sampling`, `reasoning`, `output_format`…; cada controle mostra `Default: x · Not set/Set · Reset`; `Save` grava só o que foi definido.
- Dropdown de conta na linha quando o provider tem ≥ 2 conexões; "Adicionar fallback" duplica o modelo.
- Componentes novos em `combos/[id]/` seguindo `CONVENTIONS.md` (hook por domínio, arquivo ≤ 400 linhas), strings via `translate()`.

### 5. Sugestão (regras, sem LLM)

Pós-passo sobre `assignLanes`, puro e testável:

- **Parâmetros por lane**, lendo o spec do modelo, só no grupo `reasoning` e só onde o catálogo oferece valores finitos: ordenar `values` por intensidade (`none<minimal<low<medium<high<xhigh<max`; enum fora dessa escala = não define). Simples → menor, Padrão → médio, Complexo → alto, Raciocínio → máximo. `thinking.type` = `enabled` em Raciocínio quando existir e for aplicável. `max_tokens` e sampling ficam intocados (escolha de produto, não de lane).
- Respeitar `applicability`: nunca sugerir um parâmetro que o próprio conjunto sugerido torna inaplicável.
- **Contas**: um modelo disponível em N conexões ativas entra uma vez por conta (principal + fallback), dentro do teto de 2 cópias por lane já existente (`suggestionLanes`).
- O payload da sugestão passa a carregar `{ model, connectionId, params }` por entrada e o preview mostra o que será aplicado.

## Fases

1. **Dados + catálogo + gateway.** TDD: normalização/validação de entradas, `applyRequestParamDefaults` (merge e omissão por applicability), pin de conta no combo (conta indisponível não rotaciona). Verificação ao vivo no estilo `gatewayDockerLive`.
2. **UI.** Diálogo, dropdown de conta, duplicar fallback.
3. **Sugestão.** Pós-passo de lanes + testes com specs reais (GLM e GPT dos prints).

## Riscos e pontos a verificar na Fase 1

- Casamento de ids (nosso `provider/model` × `provider/authType/model` do catálogo): medir a cobertura sobre o inventário real antes de prometer "todos os providers"; o que não casar fica sem diálogo e vira lista explícita.
- `modelparams` ainda é 0.0.x: isolar atrás de `paramSpecs.ts` para trocar a fonte sem tocar o resto.
- Interação com cache affinity e hedge: a entrada fixada em conta precisa entrar na chave de `modelPerf`/stickiness, ou duas contas do mesmo modelo misturam medições.

## Estado da Fase 1 (o que mudou do desenho acima)

- **O pacote `modelparams` traz mais que o catálogo**: `parseParams`, `dropUnsupported`, `isApplicable` e `resolveModelId`. Nada do backend da referência foi portado; `engine/services/modelParams.ts` é uma camada fina sobre ele.
- **O catálogo é por vendor/família, não por rota** (490 modelos, 22 vendors: `z-ai/glm-5.3`, `openai/gpt-5.6-sol-subscription`). O casamento é pelo **id do modelo upstream**; quando vários revendedores listam o mesmo modelo, o vendor próprio da família decide (`FIRST_PARTY`); conexão OAuth prefere a variante `-subscription`. Modelo fora do catálogo (`space-bunny-free`, `kiro/auto`) não tem parâmetros.
- **A config por entrada não mudou o tipo de `overrides`** (continua `string[]`): vive em `routing.entries[need][tier]`, alinhada por índice, só nas lanes onde algo foi configurado. O mesmo modelo pode aparecer uma vez por conta; repetição exata (modelo + conta) é colapsada.
- **Pin de conta é estrito** (`onlyConnectionId`): conta fixada bloqueada devolve `allRateLimited`, nunca outra conta. Falhou → o combo segue para o próximo candidato. O fallback gratuito limpa a config da entrada (`tryFreeFallbackChat`).
- **Parâmetros entram no corpo já traduzido** (`prepareTranslatedBody`), onde o path do catálogo é o do provider; o valor configurado vence o do cliente e o que ficou inaplicável é removido. Valores são validados contra o catálogo ao salvar (`validateSmartRoutingConfig`), com erro apontando modelo e parâmetro.
- A config viaja pelo body por símbolo (`engine/host/entryConfig.ts`): o roteador anexa o mapa por modelo, o combo entrega a n-ésima entrada à n-ésima tentativa do modelo.

## Fases 2 e 3 e fechamento

- **UI**: `GET /api/smart-routing/model-params` (spec + contas do provider); `ModelParamsDialog` gerado do catálogo, com `paramApplicability.ts` escondendo o que a regra do catálogo torna inaplicável (espelho pequeno do avaliador do pacote, para não levar 1,3 MB ao navegador); select de conta e "Add fallback" por linha; `routing.entries` acompanha arrastar/remover/duplicar/trocar.
- **Sugestão**: `laneParamHints` põe o esforço de raciocínio na posição da lane dentro da escada do próprio modelo (nunca `none`; sampling e tamanho ficam do usuário); um modelo com ≥ 2 contas entra como principal + fallback (teto de 2 cópias). O preview mostra parâmetros e nº de contas.
- **Forma do corpo**: os caminhos do catálogo são os da API do provider, então só se aplicam quando o formato-alvo do tradutor é a superfície daquele catálogo (`openai-chat-completions`↔`openai`, `openai-responses`↔`openai-responses|codex`, `anthropic-messages`↔`claude`). Outro formato (Gemini, Kiro, Cursor…) segue como traduzido: não ganha campos sem sentido. Testado com o tradutor real e o `CodexExecutor.transformRequest` (preserva `reasoning.effort`).
- **Bug achado no caminho**: `preferWarmModel` colapsava duplicatas, então em prompt grande a segunda conta do mesmo modelo sumia. Agora move todas as cópias.
- **`connectionId` é validado ao salvar** (`findForeignEntryConnection`): precisa ser conexão do dono e do provider da entrada.
- **Métricas ficam por modelo, não por conta** (decisão): `modelPerf`/bench medem a saúde do modelo; falha de conta é 429/401, que não entra no bench. Cache de afinidade move todas as cópias do modelo juntas, em ordem.
- **Escopo**: parâmetros por entrada valem no combo smart de chat. Combos comuns, imagem e vídeo não passam por `routing.entries`.
- **LLM de fallback da sugestão** entra sempre que o Jev não responde (o pedido foi "outro LLM assume"), inclusive com o motor em heurística; custa cota só ao clicar em "Sugerir".

### Pendências (precisam de credencial ou de uma sessão logada)

- ~~Jev real nas lanes~~ verificado em 2026-10-12 com a chave TypeSafe salva na conta: 14/14 modelos decididos em ~1 s. A calibração achou que o corte fixo de 0,5 expulsava o modelo de topo do Raciocínio (Jev deu 0,31); agora o corte é `max(0,25; 0,4 × melhor resposta da lane)`, com teste de regressão com as probabilidades reais.
- Conferir no navegador o diálogo, o select de conta e a fase "Deciding lanes".
- ~~Provider real com duas contas~~ verificado em 2026-10-12 (Kiro, 3 contas OAuth): `handleSingleModelChat` com `connectionId` fixado respondeu 200 na conta de prioridade 3 e na de prioridade 2 (o padrão fill-first usaria a 1), e uma conta inexistente deu 404 sem cair em outra.
- ~~LLM de fallback~~ verificado com modelo real (`deepseek-v4.1-flash`, escolhido pelo `chooseLaneClassifier`): 12/12 modelos em ~18 s, valores coerentes. Fluxo completo de "Sugerir" na conta real: 250 modelos elegíveis, Jev decidiu 112 canônicos.
- ~~Tela~~ verificada em 2026-10-12 num Chromium real (Playwright) com uma página temporária de fixture fora da autenticação (removida): achou que os controles na mesma linha do nome o truncavam (`gl...`); agora ficam na segunda linha da entrada. Diálogo conferido em claro e escuro. Não houve sessão logada nem dados reais na tela.
- Traduções: só pt-BR foi adicionada; as outras 33 línguas caem no inglês.
