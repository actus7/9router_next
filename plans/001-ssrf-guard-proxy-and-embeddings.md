# Plan 001: Proxy pools e embeddings passam pelo guard de endpoint privado

> **Executor instructions**: Siga o plano passo a passo. Rode cada verificação e confirme o resultado
> esperado antes de seguir. Se uma STOP condition ocorrer, pare e reporte — não improvise.
>
> **Drift check (rode primeiro)**: `git diff --stat 98d2947..HEAD -- src/server/security/providerEndpoint.ts src/app/api/proxy-pools/route.ts "src/app/api/proxy-pools/[id]/route.ts" src/server/llm-gateway/engine/utils/proxyFetch.ts src/server/llm-gateway/engine/handlers/embeddingsCore.ts`
> Se algum arquivo mudou, compare os trechos de "Current state" com o código; divergência = STOP.

## Status

- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: security
- **Planned at**: commit `98d2947`, 2026-10-31

## Why this matters

`assertProviderEndpointAllowed` existe para que uma conta, num deploy onde qualquer um se cadastra, não faça o
servidor buscar endereços privados (loopback, LAN, `169.254.169.254` — metadata de nuvem). Dois caminhos
escapam dele: (1) a URL de um **proxy pool** é salva sem checagem e o gateway manda a requisição inteira do
provider (com os headers `Authorization`/`x-api-key`) para ela; (2) o caminho de **embeddings** de provider
custom faz `fetch` direto no `baseUrl` da conexão, que o caminho de chat recusaria. Em ambos, o corpo da
resposta de erro volta ao chamador. Depois deste plano, os dois caminhos recusam host privado a menos que o
operador tenha optado por `ALLOW_PRIVATE_PROVIDER_ENDPOINTS=true` (self-hosted).

## Current state

- `src/server/security/providerEndpoint.ts` — o guard. Trecho:
  ```ts
  export function privateProviderEndpointsAllowed(): boolean {
    return process.env.ALLOW_PRIVATE_PROVIDER_ENDPOINTS === "true";
  }
  class ProviderEndpointBlockedError extends Error { constructor(url: string) { super(`Provider endpoint "${url}" points at a private or loopback address. ` + `Set ALLOW_PRIVATE_PROVIDER_ENDPOINTS=true on a self-hosted install to permit it.`); this.name = "ProviderEndpointBlockedError"; } }
  export function assertProviderEndpointAllowed(rawUrl: string): void {
    if (privateProviderEndpointsAllowed()) return;
    try { assertPublicUrl(rawUrl); } catch { throw new ProviderEndpointBlockedError(rawUrl); }
  }
  ```
- `src/shared/utils/ssrfGuard.ts:81-95` — `assertPublicUrl` **recusa** esquema diferente de http/https e
  **recusa URL com credenciais** (`user:pass@`). URLs de proxy legitimamente têm credenciais, então o guard
  de proxy não pode chamar `assertPublicUrl(rawUrl)` direto: tem que checar só `protocolo//host`.
- `src/app/api/proxy-pools/route.ts:14-31` — `normalizeProxyPoolInput` só checa que `proxyUrl` não é vazio.
  Usado no POST (linha ~83, `if (normalized.error) return 400`).
- `src/app/api/proxy-pools/[id]/route.ts:22-28` — `normalizeProxyPoolUpdate`, mesmo problema no PUT.
- `src/server/llm-gateway/engine/utils/proxyFetch.ts:215-238` — `proxyAwareFetch`:
  ```ts
  const vercelRelayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  if (vercelRelayUrl) { ...; return originalFetch(vercelRelayUrl, { ...options, headers: relayHeaders }); }
  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const envProxyUrl = connectionProxyUrl ? null : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  const proxyUrl = connectionProxyUrl || envProxyUrl;
  ```
  `vercelRelayUrl` vem de pools tipo vercel/cloudflare/deno (`src/lib/network/connectionProxy.ts:116-126`);
  `connectionProxyUrl` vem de pool tipo http ou do legado `providerSpecificData.connectionProxyUrl`.
  **O proxy de variável de ambiente (`HTTPS_PROXY` etc.) é configuração do operador e NÃO deve ser checado.**
- `src/server/llm-gateway/engine/handlers/embeddingsCore.ts:56` (`url = adapter.buildUrl(...)`, dentro de um
  try que já converte exceção em 400) e `:106` (`const retryUrl = adapter.buildUrl(...)`, dentro de try/catch
  após refresh de token). Nenhum chama o guard.
- Exemplo de uso correto já existente: `src/server/llm-gateway/engine/executors/default.ts:133` chama
  `assertProviderEndpointAllowed(url)` (o engine já importa de `@/server/security/providerEndpoint`).
- `src/app/api/provider-nodes/route.ts:61` — exemplo de rota que valida no save e devolve 400.

## Scope

**In scope**:
- `src/server/security/providerEndpoint.ts`
- `src/app/api/proxy-pools/route.ts`
- `src/app/api/proxy-pools/[id]/route.ts`
- `src/server/llm-gateway/engine/utils/proxyFetch.ts`
- `src/server/llm-gateway/engine/handlers/embeddingsCore.ts`
- `tests/unit/proxyEndpointGuard.test.ts` (criar)

**Out of scope**: `src/shared/utils/ssrfGuard.ts` (não alterar a semântica de `assertPublicUrl`, outros
chamadores dependem dela); o proxy de env (`getEnvProxyUrl`); as rotas `*-deploy` (geram URL pública do
próprio deploy); `connectionProxy.ts`; STT/TTS/imagem/vídeo (follow-up).

## Steps

### Step 1: escrever o teste que falha
Crie `tests/unit/proxyEndpointGuard.test.ts` (modelo de estrutura: qualquer teste em `tests/unit` que use
`vi.stubEnv`; ex. procure `stubEnv` com grep). Casos para uma nova função `assertProxyEndpointAllowed`:
- `http://127.0.0.1:8080` → lança; `http://user:pass@169.254.169.254:80` → lança, e a mensagem **não contém**
  `pass`; `http://10.0.0.5:3128` → lança; `http://proxy.example.com:8080` → não lança;
  `http://user:pass@proxy.example.com:8080` → não lança; com `vi.stubEnv("ALLOW_PRIVATE_PROVIDER_ENDPOINTS","true")`,
  `http://127.0.0.1:8080` → não lança; `not a url` → lança.
**Verify**: `npx vitest run tests/unit/proxyEndpointGuard.test.ts` → falha (função não existe).

### Step 2: implementar `assertProxyEndpointAllowed`
Em `providerEndpoint.ts`, exporte:
```ts
export function assertProxyEndpointAllowed(rawUrl: string): void {
  if (privateProviderEndpointsAllowed()) return;
  let origin: string;
  try { const u = new URL(rawUrl); origin = `${u.protocol}//${u.host}`; }
  catch { throw new ProviderEndpointBlockedError("<invalid proxy URL>"); }
  try { assertPublicUrl(`${origin}/`); } catch { throw new ProviderEndpointBlockedError(origin); }
}
```
(A mensagem usa só `origin` — nunca credenciais.) Documente com um comentário de 2-3 linhas por que é
separado de `assertProviderEndpointAllowed` (proxies têm credenciais na URL).
**Verify**: `npx vitest run tests/unit/proxyEndpointGuard.test.ts` → passa.

### Step 3: validar no save dos proxy pools
Em `normalizeProxyPoolInput` e `normalizeProxyPoolUpdate` (quando `proxyUrl` presente), chame
`assertProxyEndpointAllowed(proxyUrl)` dentro de try/catch e devolva `{ error: <mensagem do erro> }` →
as rotas já transformam `error` em 400. Adicione ao teste dois casos chamando o handler? Não — mantenha o
teste na função; apenas confirme por leitura que o 400 sai.
**Verify**: `npx vitest run tests/unit/proxyEndpointGuard.test.ts` → passa; `npm run lint` → exit 0.

### Step 4: validar em runtime no `proxyAwareFetch`
Antes de `originalFetch(vercelRelayUrl, ...)`, chame `assertProxyEndpointAllowed(vercelRelayUrl)`.
Depois de calcular `connectionProxyUrl`, se ele for não-vazio chame `assertProxyEndpointAllowed(connectionProxyUrl)`
(**não** chame para `envProxyUrl`). A exceção sobe como qualquer erro de fetch (o caller já trata).
O módulo captura `const originalFetch = globalThis.fetch` ao carregar. Em cada teste de runtime, rode
`vi.resetModules()`, instale `vi.stubGlobal("fetch", fetchMock)` e só então faça o import dinâmico de
`proxyFetch.ts`. Não importe esse módulo estaticamente no teste. Fixe a opção de endpoints privados como
desligada com `vi.stubEnv`, para não depender do ambiente do operador. Cubra relay privado e proxy de
conexão privado: a rejeição deve ter `name: "ProviderEndpointBlockedError"`, e o fetch capturado não pode
ser chamado. Inclua um relay público com resposta sintética do mock e afirme a resposta e a chamada do
mesmo mock, comprovando que a instrumentação observa o fetch correto. Faça `vi.unstubAllGlobals()`,
`vi.unstubAllEnvs()` e `vi.restoreAllMocks()` em `afterEach`, inclusive quando uma asserção falha.
Se importar `proxyFetch.ts` no teste exigir mocks pesados, STOP condition 3 abaixo.
**Verify**: `npx vitest run tests/unit/proxyEndpointGuard.test.ts` → passa.

### Step 5: guard no embeddings
Em `embeddingsCore.ts`, logo após `url = adapter.buildUrl(...)` (linha ~56, dentro do try existente) chame
`assertProviderEndpointAllowed(url)` — o catch existente já devolve 400. Idem após `retryUrl = adapter.buildUrl(...)`
(linha ~106, dentro do try existente). Importe de `@/server/security/providerEndpoint`.
**Verify**: `npx vitest run tests/unit/embeddingsAccounting.test.ts tests/unit/nomicEmbeddings.test.ts` → passam.
Adicione 1 caso em `proxyEndpointGuard.test.ts` só se der para chamar `handleEmbeddingsCore` com mocks leves;
caso contrário, registre em NOTES.

### Step 6: gate completo
**Verify**: comando de gate completo (tabela abaixo) → exit 0.

## Commands

| Propósito | Comando | Sucesso |
|---|---|---|
| Instalar | `npm ci` | exit 0 |
| Teste | `npx vitest run tests/unit/proxyEndpointGuard.test.ts` | passa |
| Gate | `NEON_AUTH_BASE_URL=https://auth.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=ci-build-placeholder-not-a-secret npm run check` | exit 0 |

## Git workflow
Branch `advisor/001-ssrf-guard-proxy-and-embeddings`. Commits em conventional commits pt-BR, ex.:
`fix(security): proxy pools e embeddings passam pelo guard de endpoint privado`. Não dar push.

## Done criteria
- [ ] `tests/unit/proxyEndpointGuard.test.ts` existe com ≥ 8 casos e passa
- [ ] Testes de runtime mockam fetch antes do import, afirmam o erro específico do guard e incluem relay público
- [ ] `grep -n "assertProxyEndpointAllowed" src/app/api/proxy-pools/route.ts "src/app/api/proxy-pools/[id]/route.ts" src/server/llm-gateway/engine/utils/proxyFetch.ts` → ≥ 4 linhas
- [ ] `grep -n "assertProviderEndpointAllowed" src/server/llm-gateway/engine/handlers/embeddingsCore.ts` → 2 chamadas
- [ ] Gate completo exit 0; `git status` só mostra arquivos in scope

## STOP conditions
- O trecho de `proxyAwareFetch` não bate com o "Current state".
- Algum teste existente de proxy/relay passa a falhar porque usa `127.0.0.1` como relay de teste — reporte
  quais, não altere o teste.
- Importar `proxyFetch.ts` num teste exige mockar mais de 3 módulos.

## Maintenance notes
- Hostname que **resolve** para IP privado ainda passa (o guard é literal, mesma limitação documentada em
  `providerEndpoint.ts`). Fechar exige o caminho DNS-pinned de `safeFetch.ts`.
- Follow-up: aplicar o mesmo guard nos cores de STT/TTS/imagem/vídeo que montam URL a partir de credenciais.
