# Dívida técnica conhecida

Itens intencionalmente adiados das fatias de refatoração. Rastrear aqui antes de abordar em trabalho dedicado.

## Riscos de segurança (fora de escopo desta revisão)

Estes três itens são **dívida real de segurança** e devem ser tratados em migração dedicada:

1. **Credenciais em plaintext no SQLite** — `apiKey`, `accessToken` e `refreshToken` de providers ainda são persistidos sem cifragem em `src/lib/db/repos/connectionsRepo.ts`.
2. **Secrets padrão previsíveis** — senha `"123456"` em `src/lib/auth/dashboardSession.ts` e fallback `API_KEY_SECRET || "endpoint-proxy-api-key-secret"` em `src/shared/utils/apiKey.ts`.
3. **CORS permissivo em `/v1`** — rotas do gateway ainda emitem `Access-Control-Allow-Origin: *` para compatibilidade com CLIs e health checks; endurecer exige auditoria de todos os clientes.

## Plaintext credentials (detalhe)

Provider connection credentials e alguns tokens OAuth ainda são armazenados ou transmitidos em plaintext em partes da stack (campos de banco, exports de config local, paths de debug). Uma passagem completa de cifragem-at-rest e redação de secrets está fora do escopo das fatias de dashboard/rotas.

## Default secrets (detalhe)

A senha admin padrão (`123456`) e o fallback `INITIAL_PASSWORD` permanecem para onboarding local-first. Caminhos de login remoto forçam troca de senha, mas o default ainda é documentado na página de login. Rotacionar defaults e remover fallbacks hard-coded exige migração de auth coordenada.

## Permissive CORS (`Access-Control-Allow-Origin: *`)

Health checks, SSE streams e algumas rotas de API ainda emitem headers CORS wildcard para CLI e tunnel probing. Restringir allowlists de origem exige auditar cada cliente (Claude Code, Codex, dashboard browser, tunnel health checks) e foi adiado.

## `/api/harness/sandbox/eval` aceita código sem autorização

A rota executa o `source` recebido no QuickJS-WASM. O sandbox não expõe rede, filesystem nem `require`, e limita memória (8 MB), stack, tamanho de fonte (64 KB) e tempo (interrupt handler), então o pior caso é consumo de CPU do processo local.

Como todas as rotas do harness, ela só chama `assertRequestRuntime()`, que é opt-out de prerender e **não** é uma guarda de autorização: a proteção efetiva hoje é o app ser local-first. Expor a instância na rede sem autenticação no proxy torna esse endpoint um vetor de DoS. Uma guarda de sessão de dashboard para as rotas de harness que aceitam código é trabalho separado.

## Estado de i18n global no módulo (risco de concorrência no SSR)

`src/i18n/runtime.ts` guarda `currentLocale` e `translationMap` em variáveis de módulo, e `RuntimeI18nProvider` as semeia durante o render. No cliente isso é correto (um documento, um locale). No servidor o módulo é compartilhado por processo: se dois requests com locales diferentes intercalarem seus renders (o que pode acontecer quando um filho suspende), o render retomado pode usar o locale do outro request.

Hoje o risco é baixo — a aplicação é local-first e single-tenant — mas a correção adequada é tornar a resolução de locale request-scoped no servidor (por exemplo `AsyncLocalStorage` ou `React.cache()` num módulo server-only) em vez de estado de módulo. Isso implica trocar a assinatura de `translate()` nos ~50 componentes que a importam diretamente, então foi adiado.

## Literais de tradução com BOM UTF-8

Os 34 arquivos em `public/i18n/literals/*.json` são gravados com BOM. `Response.json()` no browser tolera, `JSON.parse` no servidor não — o que já causou fallback silencioso para inglês e mismatch de hidratação. `src/i18n/server.ts` remove o BOM na leitura e `tests/unit/i18nLiteralFiles.test.ts` protege a regressão, mas o ideal é corrigir a ferramenta que gera esses arquivos para emitir UTF-8 sem BOM.

## Landing token migration

A landing ainda usa cores hex hard-coded (`#f97815`, `#181411`, etc.) em vez dos design tokens/CSS variables do dashboard. Paridade visual foi preservada durante o split para Server Component; migrar para tokens compartilhados é passagem de styling separada.

## Mass color rename

Renomeação em massa de hex e classes ad-hoc para o sistema de tema compartilhado (`primary`, `bg-bg`, etc.) não foi incluída. Abrange landing, componentes de marketing e cards antigos do dashboard; fazer como migração dedicada de design system para evitar regressões mistas.
