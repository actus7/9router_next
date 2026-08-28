# Roteamento Inteligente de Combos (por Complexidade e por Tarefa)

Status: **rascunho para revisão** — planejamento inicial, execução ainda não iniciada.
Data: 2026-08-27

## 1. Problema e motivação

Hoje um combo (`src/lib/open-sse/services/combo.ts`) é sempre uma lista estática de
modelos com uma estratégia (`fallback` / `round-robin` / `fusion`). A ordem é 100%
manual — não existe nenhuma noção de "esse tipo de pedido merece um modelo mais forte
(ou mais barato)".

Queremos um novo tipo de combo que decida automaticamente, por requisição, qual "nível"
de modelo usar (`Simples` / `Padrão` / `Complexo` / `Raciocínio`) e opcionalmente qual
modelo especializado usar por categoria de tarefa (`Programação`, `Análise de dados`,
`Navegação web`, `Geração de imagem`, `Geração de vídeo`, `E-mail`, `Calendário`, `Redes
sociais`, `Trading`) — nas duas telas de referência enviadas pelo usuário.

### Achado crítico da pesquisa em `github.com/mnfst/manifest`

O `manifest` já implementou exatamente esse recurso (é literalmente de onde vêm as duas
telas de referência) e **está descontinuando-o** (prazo de migração: set/2026), pelos
motivos que eles mesmos publicaram
(`https://manifest.build/blog/deprecating-rule-based-routing/`):

1. **Poluição por system prompt / envelope do harness** — ferramentas como OpenClaw e
   Hermes embrulham a mensagem do usuário em metadados grandes, fazendo a heurística
   classificar quase tudo como "complexo".
2. **Só funciona em inglês** — a detecção é por palavras-chave em inglês.
3. **Regra estática não captura complexidade semântica real** de linguagem natural.

Esses riscos são reais e relevantes aqui também: este router serve majoritariamente
harnesses de CLI (`cli-tools/`) e o público é majoritariamente pt-BR. Decisão tomada com
o usuário: seguir em frente mesmo assim, mitigando o que dá para mitigar:

- **#1** é mitigado reaproveitando o padrão que este repo já usa em
  `detectRequiredCapabilities()` (escanear só o turno atual do usuário, não o histórico)
  e portando o *envelope peeler* do próprio manifest (detecta e remove o wrapper
  `Sender (untrusted metadata): ...` antes de pontuar).
- **#2** é mitigado duplicando todas as listas de palavras-chave em pt-BR além do
  inglês.
- **#3** é uma limitação aceita conscientemente — é o preço de rodar local, em <2ms, sem
  chamada externa (que foi a alternativa explicitamente escolhida em vez de um
  classificador por LLM).

## 2. Escopo da v1

**Decisões já validadas com o usuário:**

- Estratégia de detecção: **heurística estática mitigada** (sem chamada de LLM).
- Cobertura de idioma: **pt-BR + EN** nas listas de palavras-chave.
- Modelo de dados: **novo tipo de combo nomeado** (`kind: "smart"`), não uma
  configuração global única — reaproveita 100% da infra de combos existente (API,
  validação de nome, listagem, edição).
- Motor de scoring: **porte completo** do manifest — todas as dimensões de
  palavra-chave, os 9 sinais estruturais (linguagem-agnósticos: contagem de tokens,
  profundidade de listas aninhadas, densidade de código vs. prosa, densidade de
  restrições, tamanho de saída esperado, pedidos de repetição, nº de tools, profundidade
  da conversa) e o *momentum* de sessão (viés pelas últimas classificações).

**Fora de escopo da v1 (fica registrado para decisão futura, não bloqueia o resto):**

- Botão **"Sugerir modelos"** (auto-preencher os tiers com base em preço/qualidade dos
  provedores conectados) — aparece no mockup mas não foi especificado. Vira um botão
  "TODO" desabilitado ou é simplesmente omitido da v1; ver `§9`.
- Roteamento por **header explícito** (`x-router-tier: complex`), que é a própria
  alternativa que o manifest recomenda no lugar do rule-based routing. Não conflita com
  nada do que vamos construir — é aditivo e pode entrar depois como um "escape hatch"
  para harnesses que sabem o que querem.
- Ajuste fino de pesos/limiares (boundaries) pela UI — v1 usa os mesmos valores
  default do manifest (só a lista de modelos por tier/categoria é editável pela UI,
  igual ao mockup).

## 3. Onde isso entra na arquitetura atual

Fluxo de uma requisição de chat hoje (`src/sse/handlers/chat.ts`):

```
model="nome-do-combo"
  → getComboModelsFromData(modelStr, combosData)   // combo.ts:261 — lista estática
  → handleComboChat({ models, comboStrategy, ... }) // combo.ts:289 — tenta em ordem, cai pro próximo em erro
```

Um combo `kind: "smart"` intercepta **antes** desse primeiro passo:

```
model="auto"  (combo.kind === "smart")
  → resolveSmartRoute(body, comboConfig)   // NOVO — decide qual lista de modelos usar
      1. detecta categoria de tarefa (se "Rotear por tarefa" ligado e confiança ≥ threshold)
      2. senão, pontua complexidade e escolhe o tier (se "Rotear por complexidade" ligado)
      3. senão, usa a lista "Padrão" da combo (equivalente ao tier "default" do manifest)
  → devolve um array de modelos (o "fallback chain" daquele tier/categoria)
  → handleComboChat({ models: essa lista, comboStrategy: "fallback", ... })  // REAPROVEITADO, sem mudança
```

O ponto chave: **a execução de fallback dentro de um tier não é código novo** —
`handleComboChat` (combo.ts:289) já faz exatamente "tenta o primeiro, cai pro próximo em
erro elegível, aplica cooldown em erro transitório" e vai ser reaproveitado como está.
Só a *seleção de qual lista usar* é nova.

Precedência (baseada na ordem que o manifest usa em produção, adaptada):

1. Categoria de tarefa detectada com confiança ≥ threshold (se `taskRouting.enabled`)
2. Tier de complexidade pontuado (se `complexityRouting.enabled`)
3. Lista "Padrão" da combo (sempre existe — é o `models` da combo, igual hoje)

## 4. Modelo de dados

Migração nova (`src/lib/db/migrations/002-smart-routing.ts`), segue o padrão numerado
existente:

```sql
ALTER TABLE combos ADD COLUMN routing TEXT;  -- JSON, NULL para combos que não são "smart"
```

`combos.kind` passa a aceitar o valor `"smart"` (hoje já aceita `null`/`"llm"` para chat e
outros valores para web search/fetch — ver `CombosClient.tsx:61`).

`combos.models` continua sendo o array de modelos, mas para `kind: "smart"` ele vira a
lista **"Padrão"** (fallback final, quando roteamento está desligado ou nada bateu — é o
tier `default` do manifest, "Handles every request when complexity routing is off; final
fallback otherwise").

Formato de `combos.routing` (JSON):

```ts
interface SmartRoutingConfig {
  complexity: {
    enabled: boolean; // toggle "Rotear por complexidade"
    tiers: {
      simple: string[];   // score 0-15
      standard: string[]; // score 16-40
      complex: string[];  // score 41-65
      reasoning: string[]; // score 66+
    };
  };
  task: {
    enabled: boolean; // toggle "Rotear por tarefa"
    confidenceThreshold: number; // default 0.4, igual ao manifest
    categories: Partial<Record<TaskCategory, string[]>>; // só as categorias adicionadas pelo usuário
  };
}

type TaskCategory =
  | "coding" | "data_analysis" | "web_browsing" | "image_generation"
  | "video_generation" | "email_management" | "calendar_management"
  | "social_media" | "trading";
```

Cada `string[]` é uma lista de modelos em ordem de prioridade — exatamente o mesmo
formato que `combos.models` já usa hoje, então a UI de cada coluna/categoria reaproveita
o componente `ModelItem` (drag-and-drop, setas, editar, remover) que já existe em
`CombosClient.tsx`. **Não há limite de quantidade de fallbacks por tier/categoria** —
mesmo comportamento de hoje.

## 5. Motor de scoring (`src/lib/open-sse/services/complexityScoring.ts`, novo)

Porte do `packages/backend/src/scoring/` do manifest, adaptado:

- **Keyword trie multi-idioma**: cada dimensão (`formalLogic`, `analyticalReasoning`,
  `codeGeneration`, `codeReview`, `technicalTerms`, `simpleIndicators`, `multiStep`,
  `creative`, `questionComplexity`, `imperativeVerbs`, `outputFormat`,
  `domainSpecificity`, `agenticTasks`, `relay`) ganha uma lista pt-BR ao lado da lista
  EN original. Pesos e `direction` (`up`/`down`) mantidos iguais ao manifest.
- **Envelope peeler**: porte direto de `envelope-peeler.ts` — remove wrapper tipo
  `Sender (untrusted metadata): ...` antes de escanear.
- **Sinais estruturais** (linguagem-agnósticos, sem keyword list): `tokenCount`,
  `nestedListDepth`, `conditionalLogic`, `codeToProse`, `constraintDensity`,
  `expectedOutputLength`, `repetitionRequests`, `toolCount`, `conversationDepth`.
  Porte direto — não dependem de idioma.
- **Floors baratos**: tem `tools` no request → nunca cai em `simple`; contexto estimado
  > 50k tokens → nunca cai abaixo de `complex`. Ambos de uma linha, iguais ao manifest.
- **Atalho de mensagem curta**: mensagem < 50 chars sem sinal de complexidade →
  `simple` direto, sem rodar o resto do pipeline (saudações, "ok", "obrigado" etc. —
  lista `simpleIndicators` dobrada em pt-BR).
- **Boundaries fixos** (v1, não editável pela UI): mesmos valores default do manifest
  (`simpleMax: -0.1, standardMax: 0.08, complexMax: 0.35`), com um `confidenceThreshold`
  de 0.45 igual ao original — abaixo disso, cai para `standard` (ambíguo).
- **Momentum de sessão**: diferente do manifest (que lê do histórico de mensagens em
  Postgres), aqui vai ser um `Map` em memória (mesmo padrão de
  `comboRotationState`/`assistantSessionStore` que já existem no código), chaveado pelo
  `sessionId` que `resolveSessionIdentity()` (`sessionManager.ts`) já sabe derivar de
  qualquer harness. Guarda as últimas N classificações por sessão, com TTL de eviction
  igual aos outros stores em memória do projeto. **Trade-off aceito**: reseta no restart
  do processo e não persiste — aceitável porque esta é uma instalação local/single-process,
  não um serviço distribuído multi-réplica como o manifest.

## 6. Detecção de categoria de tarefa (mesmo módulo)

Porte de `specificity-detector.ts`: 9 categorias, cada uma mapeada às dimensões de
keyword relevantes + heurística de prefixo de nome de tool (`browser_*` →
`web_browsing`, `image_*` → `image_generation` etc. — lista adaptada aos nomes de tools
reais que os harnesses deste projeto usam). Confiança computada como
`min(score / (threshold * 3), 1.0)`, igual ao original. Session stickiness (últimas 3
classificações concordando → viés pela mesma categoria) reaproveita o mesmo `Map` de
momentum da seção 5.

Threshold configurável por combo via UI (`taskRouting.confidenceThreshold`, default
0.4 — é o mesmo `≥ 40%` do mockup).

## 7. Integração no request flow

`src/sse/handlers/chat.ts` e `src/lib/open-sse/services/combo.ts` ganham:

```ts
// combo.ts — novo, ao lado de getComboModelsFromData
export function resolveSmartRoute(
  body: RequestBody,
  combo: ComboEntry, // kind === "smart"
  momentumStore: MomentumStore,
): { models: string[]; meta: RoutingDecisionMeta }
```

`chat.ts` passa a checar `combo.kind === "smart"` antes de chamar
`getComboModelsFromData`; se for smart, chama `resolveSmartRoute()` e usa o resultado
como a lista de modelos para `handleComboChat` (estratégia sempre `fallback` dentro do
tier — round-robin/fusion não fazem sentido aqui e ficam desabilitados para esse `kind`).

`RoutingDecisionMeta` (`{ tier, score, confidence, reason, category? }`) é serializado
dentro do `data` JSON de `requestDetails` (`schema.ts:152` — coluna já existe, é um blob
livre, não precisa de migração) para aparecer no `RequestDetailsTab` como badge — mesmo
princípio do "reason" que o manifest expõe (`scored`, `tool_detected`, `large_context`,
`momentum`, `short_message`, `specificity`, `ambiguous`).

## 8. UI

`CombosClient.tsx` está com 975 linhas hoje — já no limite/acima do teto de 800
linhas do projeto. Em vez de crescer ainda mais esse arquivo:

- **Criar combo**: o modal de criação ganha uma escolha de tipo (`Fallback/Round-robin/
  Fusion` vs `Roteamento inteligente`) — só isso muda em `CombosClient.tsx`.
- **Editar um combo `kind: "smart"`**: em vez de abrir o `ComboFormModal` atual, navega
  para uma página dedicada nova, `src/app/(dashboard)/dashboard/combos/[id]/routing/
  RoutingClient.tsx` (segue o mesmo padrão de rota dinâmica que `providers/[id]/` já
  usa), com dois blocos que batem com as duas imagens de referência:
  - **Bloco "Roteamento padrão"**: toggle `complexity.enabled` + 4 colunas
    (Simples/Padrão/Complexo/Raciocínio) cada uma reaproveitando o `ModelItem`
    (drag-and-drop) e o `ModelSelectModal` que já existem.
  - **Bloco "Roteamento por categoria de tarefa"**: toggle `task.enabled` + um seletor
    de threshold + lista de categorias adicionadas via dropdown (as 9 opções fixas),
    cada categoria vira um card igual ao de complexidade.
- Extração de um `ModelFallbackColumn` compartilhado (usado tanto pelos 4 tiers quanto
  pelas categorias de tarefa) evita duplicar a lógica de drag-and-drop 13 vezes.

## 9. "Sugerir modelos" (fora do escopo v1)

O botão aparece no mockup mas nunca foi especificado nesta conversa. Fica como TODO
explícito — não bloqueia o resto. Ideia registrada para quando for priorizado: usar os
provedores já conectados (`getProviders`) + preço conhecido (`providers/pricing.ts`) para
pré-popular os 4 tiers automaticamente (barato→simples, caro/raciocínio→reasoning).

## 10. Testes

Seguindo a convenção do projeto: todo código não trivial deixa um check executável.

- `complexityScoring.test.ts`: casos EN e pt-BR por dimensão, incluindo os textos reais
  usados nos testes de regressão do manifest (envelope OpenClaw, mensagem curta,
  override de lógica formal, tool-detected floor, contexto grande).
- `specificityDetector.test.ts`: uma amostra por categoria (EN + pt-BR) + caso de
  confiança abaixo do threshold caindo para complexidade.
- Teste de integração em `combo.test.ts` (se existir suíte hoje) ou script `demo()`
  cobrindo: combo smart sem nenhum roteamento ligado → usa `models` padrão; só
  complexidade ligada; só tarefa ligada; os dois ligados com tarefa ganhando por
  confiança alta; fallback dentro do tier escolhido quando o 1º modelo falha.

## 11. Fases de implementação (visão geral — plano detalhado fica para depois da revisão)

1. Motor de scoring + detector de especificidade, com testes, sem tocar em DB/UI/rota.
2. Migração de DB + `resolveSmartRoute()` + integração em `chat.ts` (combo smart
   funcional só via API/curl, sem UI ainda).
3. UI: seletor de tipo no create modal + página `combos/[id]/routing`.
4. Observabilidade: expor `RoutingDecisionMeta` no `RequestDetailsTab`.

---

**Pontos em aberto para sua revisão:**

- Nomes exatos das 9 categorias de tarefa em pt-BR na UI (usei os nomes do seu mockup).
- Se o botão "Sugerir modelos" deve entrar já na v1 ou fica mesmo para depois (§9).
- Se o "escape hatch" de header explícito (§2) deve entrar já ou fica para depois.
