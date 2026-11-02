# Plan 003: Falhas de upstream do gateway voltam a aparecer no log, com segredos mascarados

> **Executor instructions**: Siga o plano passo a passo; rode cada verificação. STOP conditions → pare e reporte.
>
> **Drift check (rode primeiro)**: `git diff --stat 98d2947..HEAD -- src/server/llm-gateway/utils/logger.ts src/server/llm-gateway/engine/handlers/chatCore/upstreamErrors.ts src/server/llm-gateway/engine/utils/requestLogger.ts`

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: MED · **Depends on**: none · **Category**: bug
- **Planned at**: commit `98d2947`, 2026-10-31

## Why this matters
O caminho de chat recebe o módulo de log `import * as log from "../utils/logger"` (`application/chat.ts:30`) e
todo o tratamento de falha chama `log?.errorLine(...)` / `log?.line(...)`. Esses dois exports **não existem**
em `logger.ts` — sobraram só os comentários deles (linhas ~23-30). Resultado: erro 4xx/5xx de upstream, erro
de execução com stack, timeout de primeiro chunk e resposta non-SSE bloqueada **nunca geram linha de log no
servidor**; incidentes não são diagnosticáveis. Cuidado: ao religar, a linha de erro inclui `providerUrl`, e o
executor Vertex põe a API key na query (`?key=`). Religar sem mascarar começaria a gravar chaves em log.

## Current state
- `src/server/llm-gateway/utils/logger.ts` — exports atuais: `debug`, `info`, `warn`, `error`, `request`,
  `maskKey`. Linhas ~23-33 são comentários órfãos:
  ```ts
  // Print one correlated line: [time] tag symbol message
  // Like line() but always printed regardless of LOG_LEVEL (errors must never be hidden)
  ```
  Constantes disponíveis no arquivo: `LOG_LEVELS`, `LEVEL`, `formatTime()`.
- `src/server/llm-gateway/engine/handlers/chatCore/upstreamErrors.ts:50-51` e `:149-152`:
  ```ts
  if (log?.errorLine) {
    const urlStr = providerUrl ? `\n    URL: ${providerUrl}` : "";
    log.errorLine(reqTag, "✗", `ERROR ${statusCode} · ${provider}/${model} · ${Date.now() - requestStartTime}ms${urlStr}\n    ${errMsg}`);
  }
  ```
- Outros chamadores: `chatCore/streamingHandler.ts:96,127,146`, `engine/utils/streamHandler.ts:43`
  (`const emit = isError ? log?.errorLine : log?.line;` com fallback `console.log`).
- Tipo esperado: `chatCore/types.ts:20` `errorLine?: (...args: unknown[]) => void;`
- Mascaramento existente, **não exportado**: `src/server/llm-gateway/engine/utils/requestLogger.ts:106`
  ```ts
  function maskUrlSecrets(url: string): string {
    if (!url || process.env.LOG_UNMASKED_CREDENTIALS === "true") return url;
    return url.replace(/([?&](?:key|api_key|apikey|access_token|token)=)[^&#]+/gi, "$1***");
  }
  ```
- Redação de texto: `redactSecrets(text)` exportado de `src/shared/observability/routingTrace.ts:254`.
  O engine só alcança esse módulo por `src/server/llm-gateway/engine/host/routingTrace.ts`; adicione
  `redactSecrets` ao re-export existente e importe do seam, nunca diretamente de `@/shared/observability`.

## Scope
**In scope**: `src/server/llm-gateway/utils/logger.ts`, `src/server/llm-gateway/engine/utils/requestLogger.ts`
(só adicionar `export` a `maskUrlSecrets`), `src/server/llm-gateway/engine/handlers/chatCore/upstreamErrors.ts`,
`src/server/llm-gateway/engine/host/routingTrace.ts` (somente re-export de `redactSecrets`),
`tests/unit/gatewayLoggerLines.test.ts` (criar).
**Out of scope**: mudar formato/nível de `debug/info/warn/error`; `streamingHandler.ts` e `streamHandler.ts`
(passam a funcionar sozinhos quando os exports existirem); qualquer UI.

## Steps
### Step 1: teste que falha
`tests/unit/gatewayLoggerLines.test.ts`:
- `import * as log from "@/server/llm-gateway/utils/logger"`; espere `typeof log.line === "function"` e
  `typeof log.errorLine === "function"`.
- `errorLine` imprime via `console.error` mesmo com `LOG_LEVEL=ERROR` (use `vi.spyOn(console, "error")`;
  o `LEVEL` é lido no load do módulo — use `vi.stubEnv` + `vi.resetModules()` + import dinâmico).
- `line` **não** imprime com `LOG_LEVEL=ERROR` e imprime (via `console.log`) com `LOG_LEVEL=INFO`.
**Verify**: `npx vitest run tests/unit/gatewayLoggerLines.test.ts` → falha.

### Step 2: adicionar os exports
Em `logger.ts`, substitua os dois comentários órfãos por:
```ts
// Print one correlated line: [time] tag symbol message
export function line(tag: string, symbol: string, message: string): void {
  if (LEVEL > LOG_LEVELS.INFO) return;
  console.log(`[${formatTime()}] ${tag} ${symbol} ${message}`);
}
// Like line() but always printed regardless of LOG_LEVEL (errors must never be hidden)
export function errorLine(tag: string, symbol: string, message: string): void {
  console.error(`[${formatTime()}] ${tag} ${symbol} ${message}`);
}
```
Remova os outros comentários órfãos (tag rotativa, tag por sessão, fmtThink) — são de funções que não existem.
**Verify**: teste do Step 1 passa.

### Step 3: mascarar segredos antes de logar
- `requestLogger.ts`: troque `function maskUrlSecrets` por `export function maskUrlSecrets`.
- `engine/host/routingTrace.ts`: adicione `redactSecrets` ao re-export; no handler use
  `import { redactSecrets } from "../../host/routingTrace"`, respeitando a fronteira do engine.
- `upstreamErrors.ts:150-151`: use `maskUrlSecrets(providerUrl)` na `urlStr` e passe a mensagem final por
  `redactSecrets(...)`. Faça o mesmo (`redactSecrets`) na linha `:51` (que inclui `errMsg` e `err.stack`).
- Teste novo no mesmo arquivo: chame `maskUrlSecrets("https://x.googleapis.com/v1/m:generate?key=AIzaSyFAKEFAKEFAKEFAKEFAKE00&alt=sse")`
  e espere `key=***` e `alt=sse` preservado.
**Verify**: `npx vitest run tests/unit/gatewayLoggerLines.test.ts` → passa.

### Step 4: regressões
**Verify**: `npx vitest run tests/unit --reporter=dot` termina sem falhas novas em relação a antes (rode
também no início do plano para ter a linha de base; se a base já tiver falhas, registre-as em NOTES).
Depois o gate completo.

## Commands
| Propósito | Comando | Sucesso |
|---|---|---|
| Instalar | `npm ci` | exit 0 |
| Teste | `npx vitest run tests/unit/gatewayLoggerLines.test.ts` | passa |
| Gate | `NEON_AUTH_BASE_URL=https://auth.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=ci-build-placeholder-not-a-secret npm run check` | exit 0 |

## Git workflow
Branch `advisor/003-restore-gateway-error-logging`; commit ex.: `fix(gateway): falhas de upstream voltam ao log, com URL mascarada`.

## Done criteria
- [ ] `grep -n "^export function \(line\|errorLine\)" src/server/llm-gateway/utils/logger.ts` → 2 linhas
- [ ] `grep -n "maskUrlSecrets\|redactSecrets" src/server/llm-gateway/engine/handlers/chatCore/upstreamErrors.ts` → ≥ 2
- [ ] Teste novo passa; gate completo exit 0; só arquivos in scope modificados

## STOP conditions
- Algum teste existente passa a falhar porque esperava *não* haver saída de log (ex.: snapshot de console).
- `upstreamErrors.ts` não tem as linhas descritas.

## Maintenance notes
- Toda nova linha de log que inclua URL ou corpo de upstream deve passar por `maskUrlSecrets`/`redactSecrets`.
- `LOG_UNMASKED_CREDENTIALS=true` desliga o mascaramento de URL — só para debug local.
