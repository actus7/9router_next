# Plan 013: Piso de cobertura reflete a realidade e o `handleChatCore` ganha testes de caracterização

> **Executor instructions**: Siga o plano; rode cada verificação. STOP conditions → pare e reporte.
>
> **Drift check (rode primeiro)**: `git diff --stat 98d2947..HEAD -- vitest.config.ts src/server/llm-gateway/engine/handlers/chatCore.ts`

## Status
- **Priority**: P2 · **Effort**: M · **Risk**: LOW · **Depends on**: candidata com os planos de comportamento/testes selecionados integrados; 002 não é dependência · **Category**: tests
- **Planned at**: commit `98d2947`, 2026-10-31

## Why this matters
O piso global em `vitest.config.ts` está travado na medição de 2026-09-11 (statements 14,7%), enquanto a
cobertura real já passa de ~30%: metade da suíte poderia sumir com o CI verde — o próprio comentário do
arquivo diz para subir o piso quando a cobertura cresce. E `handleChatCore`
(`src/server/llm-gateway/engine/handlers/chatCore.ts:47`), por onde passa toda requisição de chat do gateway,
tem 0% de cobertura: todos os testes que a cercam a substituem por `vi.mock`, e os únicos que a carregam de
verdade são testes "live" pulados no CI. Uma regressão no setup de stream, no disconnect ou no abort do hedge
passa pelo CI.

## Current state
- `vitest.config.ts:19-34` (leia o bloco inteiro): comentário pedindo para subir os limites; `thresholds`
  globais `statements: 14.7, branches: 9.9, functions: 14.5, lines: 15.6` + limites por arquivo (ex.
  `"src/shared/utils/ssrfGuard.ts": { statements: 80, ... }`).
- `src/server/llm-gateway/engine/handlers/chatCore.ts` — `handleChatCore` em `:47`; `:315-319` registra o
  listener de abort do hedge (`attemptSignal` → `handleDisconnect("hedge_lost")`). Divide-se em
  `chatCore/phases.ts`, `chatCore/streamingHandler.ts`, `chatCore/upstreamErrors.ts`.
- Testes que mockam `handleChatCore`: `tests/unit/accountFallbackLoop.test.ts:18`, `freeFallbackChat.test.ts:29`,
  `noAccountStatusContract.test.ts:34`. Testes live que usam o real: `xiaomiGatewayLive.test.ts:54`,
  `synapseLoopLive.test.ts:64` — leia-os para ver como montar os argumentos de `handleChatCore` com executor/fetch reais.

## Scope
**In scope**: `vitest.config.ts` (só `thresholds` e comentário com data/medição), `tests/unit/chatCoreCharacterization.test.ts` (criar).
**Out of scope**: qualquer arquivo em `src/` (este plano não muda comportamento); outros testes.

## Steps
### Step 1: testes de caracterização de `handleChatCore`
Crie `tests/unit/chatCoreCharacterization.test.ts`. Mocke **só a borda de rede** (`globalThis.fetch` ou o
`proxyAwareFetch` usado pelo executor default) e o que tocar banco/settings (siga como os testes live montam a
chamada, trocando a rede por mocks). Três casos, cada um afirmando **saída**, não só chamadas de mock:
1. Stream de sucesso: o upstream devolve SSE OpenAI com 2 deltas + `[DONE]`; ler o `Response` resultante dá
   os dois deltas na ordem e status 200.
2. `attemptSignal` já abortado antes da chamada: o resultado é um erro/abort (afirme o status ou o shape do
   resultado observado — caracterize o que o código faz hoje).
3. Upstream responde 500 com corpo JSON de erro: o resultado tem o status de erro propagado e uma mensagem
   não vazia.
Caracterização = registrar o comportamento atual; se algo parecer bug, **não corrija**, registre em NOTES.
**Verify**: `npx vitest run tests/unit/chatCoreCharacterization.test.ts` → 3 passam; `npx vitest run tests/unit/chatCoreCharacterization.test.ts --coverage --coverage.include=src/server/llm-gateway/engine/handlers/chatCore.ts`
→ statements de `chatCore.ts` > 0%.

### Step 2: medir e subir o piso
`npm run test:coverage` e leia o resumo global (`All files`). Defina cada limite global = (valor medido − 0,5),
arredondado para 1 casa. Adicione limites por arquivo, iguais a (medido − 2) e no máximo 80, para:
`src/server/llm-gateway/application/accessScope.ts`, `src/server/application/http/usageLimits.ts`,
`src/server/llm-gateway/engine/services/smart-routing/router.ts` (confira os caminhos com `ls`; se um não
existir, pule-o e anote). Atualize o comentário com a data e os números medidos.
**Verify**: `npm run test:coverage` → exit 0.
Use uma medição nova da candidata integrada. O `coverage/coverage-final.json` existente foi gerado em
2026-10-31 e não comprova cobertura da retomada de 2026-11-01. Não derive limites desse artefato antigo.

### Step 3: gate completo → exit 0.

## Commands
| Propósito | Comando | Sucesso |
|---|---|---|
| Instalar | `npm ci` | exit 0 |
| Gate | `NEON_AUTH_BASE_URL=https://auth.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=ci-build-placeholder-not-a-secret npm run check` | exit 0 |

## Git workflow
Branch `advisor/013-coverage-floor-and-chatcore-tests`; dois commits: `test(gateway): caracterização do handleChatCore`
e `test: piso de cobertura acompanha a medição de 2026-10-31`.

## Done criteria
- [ ] teste novo com 3 casos que afirmam saída (corpo/status), passando
- [ ] `grep -n "statements: 14.7" vitest.config.ts` → nada; novos números no comentário
- [ ] `npm run test:coverage` e gate exit 0; só os 2 arquivos in scope

## STOP conditions
- Montar `handleChatCore` com mocks exige mockar mais de 6 módulos ou alterar código de `src/` — entregue só o
  Step 2 e reporte o que bloqueou o Step 1.
- A cobertura global medida for menor que os limites atuais.

## Maintenance notes
- Ao fazer merge depois dos planos 001–011 a cobertura sobe; rode o Step 2 de novo no branch final se quiser
  o piso mais justo.
- Testes que só afirmam chamadas de mock (`durableRunStream.test.ts`, `streamClientDisconnect.test.ts`,
  `streamFirstChunkTimeout.test.ts`) merecem asserções de saída — follow-up.
