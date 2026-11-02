# Plan 005: A API key é lida do mesmo jeito no gate da rota e dentro do handler

> **Executor instructions**: Siga o plano; rode cada verificação. STOP conditions → pare e reporte.
>
> **Drift check (rode primeiro)**: `git diff --stat 98d2947..HEAD -- src/server/llm-gateway/auth/accountSelection.ts src/server/application/http/gatewayRoute.ts`

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: bug
- **Planned at**: commit `98d2947`, 2026-10-31

## Why this matters
Há dois parsers de API key que discordam. `gatewayRoute` (que envolve toda rota `/v1/*`) aceita
`authorization: bearer` em qualquer caixa (com trim), `x-api-key`, `x-goog-api-key` e `?key=`. Os handlers
(`handleChat`, embeddings, tts, stt, imagem, vídeo, search, fetch) chamam `extractApiKey` de
`accountSelection.ts`, que só aceita `"Bearer "` exato ou `x-api-key`. O gate de chave dentro do handler
(`requireGatewayApiKey`) só pula a checagem se as duas leituras forem iguais; senão, com `requireApiKey` ligado
(padrão), responde 401 "Missing API key". Efeito: cliente Gemini nativo (`x-goog-api-key` ou `?key=`) e
cliente que manda `bearer` minúsculo passam pelo gate da rota e levam 401 do handler; a key também some da
atribuição de uso.

## Current state
- `src/server/application/http/gatewayRoute.ts:21-33` (função **não exportada**, usada em `:56`):
  ```ts
  function extractApiKey(request: Request): string | null {
    const authHeader: string | null = request.headers.get("authorization");
    if (authHeader?.toLowerCase().startsWith("bearer ")) return authHeader.slice(7).trim() || null;
    const apiKeyHeader: string | null = request.headers.get("x-api-key");
    if (apiKeyHeader) return apiKeyHeader;
    const googleApiKeyHeader: string | null = request.headers.get("x-goog-api-key");
    if (googleApiKeyHeader) return googleApiKeyHeader;
    try { return new URL(request.url).searchParams.get("key"); } catch { return null; }
  }
  ```
- `src/server/llm-gateway/auth/accountSelection.ts:465-477` (exportada, usada por 9 handlers em
  `src/server/llm-gateway/application/{chat,embeddings,fetch,imageGeneration,search,stt,tts,videoGeneration}.ts`):
  ```ts
  export function extractApiKey(request: Request): string | null {
    const authHeader: string | null = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) { return authHeader.slice(7); }
    const xApiKey: string | null = request.headers.get("x-api-key");
    if (xApiKey) { return xApiKey; }
    return null;
  }
  ```
- `src/server/llm-gateway/application/gatewayApiKey.ts:36-50` — `requireGatewayApiKey(apiKey)`.
- `src/dashboardGuard.ts:134` tem uma terceira cópia; **fica fora** (roda no proxy/middleware e não deve
  importar o módulo de seleção de contas, que puxa repos de banco).

## Scope
**In scope**: `src/server/llm-gateway/auth/accountSelection.ts`, `src/server/application/http/gatewayRoute.ts`,
`tests/unit/extractApiKey.test.ts` (criar).
**Out of scope**: `src/dashboardGuard.ts`; os 9 handlers (continuam chamando `extractApiKey` — só a
implementação muda); `gatewayApiKey.ts`.

## Steps
### Step 1: teste que falha
`tests/unit/extractApiKey.test.ts` importando `extractApiKey` de `@/server/llm-gateway/auth/accountSelection`
(se o import puxar banco, mocke `@/lib/db/repos/*` como fazem outros testes que importam accountSelection —
`grep -l "auth/accountSelection" tests/unit` para achar o padrão). Casos com `new Request("https://gw.test/v1/x", { headers })`:
`Authorization: Bearer k1` → `k1`; `authorization: bearer k2 ` → `k2`; `x-api-key: k3` → `k3`;
`x-goog-api-key: k4` → `k4`; URL `https://gw.test/v1beta/models/m:generateContent?key=k5` → `k5`;
`Authorization: Bearer   ` (só espaços) → `null`; sem nada → `null`; bearer tem precedência sobre `x-api-key`.
**Verify**: `npx vitest run tests/unit/extractApiKey.test.ts` → falham os casos 2, 4, 5, 6.

### Step 2: uma implementação só
Substitua o corpo de `extractApiKey` em `accountSelection.ts` pela lógica de `gatewayRoute.ts` (acima).
Em `gatewayRoute.ts`, apague a função local e importe `extractApiKey` de `@/server/llm-gateway/auth/accountSelection`
(a camada `server/application` já importa de `server/llm-gateway` — ver os imports do topo do arquivo).
Mantenha o comentário JSDoc explicando os quatro lugares onde a key pode vir.
**Verify**: teste do Step 1 passa; `npx vitest run tests/unit --reporter=dot` sem falhas novas
(tire a linha de base antes do Step 2).

### Step 3: gate completo → exit 0.

## Commands
| Propósito | Comando | Sucesso |
|---|---|---|
| Instalar | `npm ci` | exit 0 |
| Gate | `NEON_AUTH_BASE_URL=https://auth.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=ci-build-placeholder-not-a-secret npm run check` | exit 0 |

## Git workflow
Branch `advisor/005-unify-gateway-api-key-extraction`; commit ex.: `fix(gateway): handlers leem a API key como o gate da rota (x-goog-api-key, ?key=, bearer)`.

## Done criteria
- [ ] `grep -c "function extractApiKey" src/server/application/http/gatewayRoute.ts` → 0
- [ ] `grep -n "x-goog-api-key" src/server/llm-gateway/auth/accountSelection.ts` → 1
- [ ] teste novo (≥ 8 casos) passa; gate exit 0; só arquivos in scope

## STOP conditions
- Importar `accountSelection` em `gatewayRoute.ts` cria ciclo de import (erro de build/teste) — reporte.
- Algum teste existente afirma que `?key=` **não** deve ser aceito.

## Maintenance notes
- A cópia em `dashboardGuard.ts` continua separada (middleware). Se mudar a regra, mude nos dois.
