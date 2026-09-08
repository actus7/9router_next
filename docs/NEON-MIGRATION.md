# Migração para Neon (Postgres + Auth + multi-tenant)

Estado: **em andamento**. Iniciada em 2026-09-07.

Este documento é a fonte de verdade da migração enquanto ela não termina. As
decisões abaixo foram tomadas com o usuário e não devem ser reabertas sem ele.

## Alvo

Projeto Neon `NewModelHub` — `damp-tooth-54040070`, Postgres 18, `aws-us-east-2`,
branch default `br-shy-water-axc5vdj9`, database `neondb`.

- `DATABASE_URL` → endpoint **pooled** (`-pooler`), usado pela app.
- `DIRECT_URL` → mesmo endpoint sem `-pooler`, para DDL/migração.
- `NEON_AUTH_BASE_URL` → `https://ep-patient-tooth-axqr719r.neonauth.c-4.us-east-2.aws.neon.tech/neondb/auth`
- `NEON_AUTH_COOKIE_SECRET` → gerado localmente, 32 bytes base64.

Neon Auth já está provisionado com backend **Better Auth**; o schema `neon_auth`
existe no banco (tabelas `user`, `session`, `account`, `organization`, ...).
O schema `public` estava **vazio** no início da migração.

## Decisões

### 1. Multi-tenant, tenant = `user.id` do Neon Auth

Cada usuário se cadastra e enxerga apenas os próprios dados. Não há
organizations: um usuário é um tenant. Trocar para times depois significa mudar
o resolver em `src/lib/db/tenant.ts` e os valores gravados em `userId` — nenhum
repo muda.

Cadastro segue **aberto** (`allow_sign_up: true`), o que só é seguro porque o
isolamento é por linha, não por instância.

### 2. Isolamento por `AsyncLocalStorage`, falhando fechado

`src/lib/db/tenant.ts` guarda o dono da requisição. `currentTenantId()` **lança**
quando não há contexto, em vez de devolver vazio: contexto ausente é caminho de
código que esqueceu de estabelecer um, e responder "nenhuma linha" esconde o bug
até o dia em que o mesmo caminho responde com as linhas de outra pessoa.

Dois pontos estabelecem tenant, ambos são entrada, nunca regra de negócio:
- requisição do dashboard → sessão do Neon Auth
- requisição do gateway (`/v1/...` com API key) → dono da key
  (`resolveApiKeyOwner`, a única query deliberadamente sem filtro de tenant)

> Upgrade path: RLS no Postgres. Não foi feito agora porque o driver HTTP abre
> uma transação por query, o que exige `SET LOCAL` a cada chamada. O filtro na
> aplicação + o gate de teste cobrem o mesmo risco por muito menos código.

### 3. Todas as tabelas ganham `userId`, exceto `_meta`

`_meta` guarda estado da instância (hoje só a versão da app que subiu por
último). Todo o resto é do tenant.

Onde a chave já era um uuid surrogate, `userId` é coluna comum e a PK não muda.
Onde a chave era **natural ou fornecida pelo chamador**, ela entra na PK, porque
esses valores repetem entre tenants de propósito:
`settings(userId)`, `kv(userId, scope, key)`, `usageDaily(userId, dateKey)`,
`smartModelProfiles(userId, modelKey)`,
`modelAvailability(userId, connectionId, modelId)` (ids sintéticos `noauth:<provider>`),
`agentSkills(userId, id)` e `pluginRows(userId, id)` (ids declarados pelo bundle),
`agentSkillFiles(userId, skillId, filePath)`,
`harnessEvents(userId, sessionId, seq)`,
`harnessMessageIndex(userId, sessionId, messageId)`.

`apiKeys.key` continua **UNIQUE global**: é a credencial do gateway e o tenant é
resolvido *a partir dela*.

### 4. Auth: só Neon Auth. OIDC e SAML saem

`src/lib/auth/oidc.ts`, `saml.ts`, suas rotas e os campos de settings
(`authMode`, `ssoType`, `oidcIssuerUrl`, `oidcClientId`, `oidcClientSecret`,
`oidcScopes`, `requireLogin`) são removidos. Login social passa a ser o Google
OAuth do próprio Neon Auth.

A senha única de operador (`INITIAL_PASSWORD` + bcrypt em `settings.password`)
deixa de existir: não há mais "o operador", há contas.

### 5. Sem migração de dados

O SQLite local (`%APPDATA%\modelhub\db\data.sqlite`, 1,2 MB) **não** é migrado.
O Neon sobe vazio e os providers são reconfigurados na mão. O arquivo local não
é apagado.

Consequência: a cadeia de migrações versionadas 001–010 é específica de SQLite e
não tem histórico para converter. Ela foi removida; o schema nasce do
`TABLES` declarativo em `src/lib/db/schema.ts`, sincronizado de forma aditiva a
cada boot por `syncSchema()` em `migrate.ts`.

## Porte do SQL — o que dispensou reescrita

O ganho de escala veio de três escolhas:

1. **Placeholders continuam `?`.** O adapter traduz `?` → `$n`, respeitando
   literais entre aspas e comentários `--`. ~690 ocorrências ficaram intocadas.
2. **Identificadores continuam sem aspas.** Postgres dobra
   `machineId` → `machineid` de forma consistente em DDL e em query, então
   `WHERE machineId = ?` funciona sem mudança. O único efeito é o **nome de
   coluna no resultado** vir minúsculo; o adapter remapeia para camelCase a
   partir do dicionário de colunas do próprio `schema.ts` (mais o único alias
   camelCase do código, `AS nextSeq`).
3. **Tipos quase todos iguais.** Booleanos seguem `INTEGER` 0/1 e datas seguem
   `TEXT` ISO-8601 — Postgres aceita ambos e `isActive = 1` continua válido.
   Exceção deliberada: `cost` virou `DOUBLE PRECISION`, porque `REAL` em
   Postgres é float4 (~7 dígitos) onde o `REAL` do SQLite era double.

O que **precisou** de porte, por ser pequeno e localizado:

| Construção SQLite | Ocorrências | Destino Postgres |
|---|---|---|
| `PRAGMA ...` | 11 | removido |
| `INSERT OR REPLACE` | 24 | `INSERT ... ON CONFLICT DO UPDATE` |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | 2 | `GENERATED BY DEFAULT AS IDENTITY` |
| FTS5 (`MATCH`) em `harnessMessageIndex` | 1 tabela, 2 queries | coluna gerada `tsvector` + índice GIN |
| `.changes` do resultado | — | `rowCount` |

`lastInsertRowid` aparecia só em assinaturas de interface; nenhum chamador o
consumia, então saiu do contrato do adapter.

## Vazamentos que não eram SQL

Filtrar as queries não bastava. Três caches em memória de módulo eram
compartilhados entre contas e nenhum filtro de banco os alcançaria:

- `usageRepo`: `pendingRequests`, `lastErrorProvider`, `pendingTimers` e o cache
  de nomes de conexão viraram um `Map<userId, TenantRuntime>`.
- `usageRepo`: o ring buffer das últimas 50 requisições foi **removido** — virou
  uma query filtrada por tenant. Um ring por conta viveria para sempre num
  processo que serve milhares.
- `requestDetailsRepo`: o cache de `ObservabilityConfig` passou a ser por tenant,
  e o buffer de escrita — que é drenado por um `setTimeout`, fora de qualquer
  requisição — agora carimba o `userId` em cada item na hora do enfileiramento e
  agrupa por dono no flush.

## Fases

- [x] **0. Prep** — deps (`@neondatabase/serverless`, `@neondatabase/auth`), `.env` apontando para o projeto novo.
- [x] **1a. Contexto de tenant** — `src/lib/db/tenant.ts`.
- [x] **1b. Adapter Postgres** — `src/lib/db/adapters/postgresAdapter.ts`: `?`→`$n`, remap de colunas, transação async via `AsyncLocalStorage`, `Pool`.
- [x] **1c. Schema** — tipos Postgres, coluna `userId`, PKs compostas, `tsvector`.
- [x] **1d. Driver + migrate** — só Postgres; sync declarativo; removidos `migrations/`, `backup.ts`, `paths.ts`, `helpers/metaStore.ts` e os 4 adapters SQLite.
- [x] **2. Repos** — `await` no adapter + filtro de tenant nos 25 repos, `index.ts`, `kvStore` e `data-access.ts`.
- [x] **3. Neon Auth** — `lib/auth/server.ts` + `client.ts` + `paths.ts`, `app/api/auth/[...path]`, `proxy.ts` compondo guard e middleware, telas em `app/auth/[path]` e `app/auth/settings`; OIDC, SAML e a senha única removidos.
- [x] **4. Resolver de tenant no gateway** — `gatewayRoute` resolve `resolveApiKeyOwner` e entra em `withTenant` nas 23 rotas `/api/v1*`.
- [x] **5a. Gate de isolamento** — `tests/unit/tenantIsolation.test.ts` reprova query em tabela de tenant sem `userId`, com allowlist explícita.
- [x] **5b. Setup de tenant nos testes** — `tests/setup/tenant.ts` + `tests/setup/emptyAdapter.ts`.
- [x] **5c. Gate de cobertura de rota** — `tests/unit/tenantRouteCoverage.test.ts` reprova rota de dashboard sem `tenantRoute` e rota de gateway sem `gatewayRoute`.
- [x] **6a. `.env.example`** — `DATABASE_URL` (pooled), `DIRECT_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `DASHBOARD_ALLOWED_HOSTS`.
- [x] **6b. `ARCHITECTURE.md`** — fronteira de `lib/db` reescrita, propriedade por conta e os quatro pontos de entrada documentados.
- [ ] **6c. Deploy** — `DEPLOYMENT.md`, `OPERATIONS.md`, variáveis na Vercel, domínio de produção em `trusted_origins` do Neon Auth.

## Onde o tenant é estabelecido

Quatro entradas, porque o Next roda middleware num contexto de execução
separado do handler — um `AsyncLocalStorage` definido em `proxy.ts` não chega
aos repos.

| Entrada | Como | Aplicado em |
|---|---|---|
| Rota de dashboard | `tenantRoute(handler)` → sessão Neon Auth | 132 arquivos em `app/api/**` |
| Rota de gateway | `gatewayRoute(handler)` → dono da API key | 23 arquivos em `app/api/v1*` |
| Server Action | `assertDashboardSession()` → `enterTenant` | 4 arquivos em `application/actions` |
| Server Component | `requireTenantPage()` → `enterTenant` | 10 páginas do dashboard |
| Job de fundo | `forEachTenant()` → uma passada por conta | refresh de token, quota ping, startup |

`withTenant` (escopo de callback) é a forma padrão. `enterTenant` existe só para
Server Actions e Server Components, que não recebem um callback para envolver.

## O que a autenticação por contas quebrou de propósito

Três coisas eram coerentes com um operador único e deixaram de ser:

- **`requireLogin` / modo local sem login.** Não existe mais "sem login": toda
  linha tem dono, então uma requisição sem conta não tem o que ler.
- **`requireApiKey`.** A key *é* o resolvedor de tenant no gateway, e o
  interruptor morava em `settings` — tabela que não dá para ler antes de saber o
  tenant. Key agora é sempre obrigatória.
- **`tunnelDashboardAccess`.** Mesmo impasse: o middleware decide antes de saber
  quem pergunta. Virou `DASHBOARD_ALLOWED_HOSTS` no ambiente.

E uma que precisou de um dono explícito: `cloudflared` e `tailscaled` são um
processo por máquina, mas `tunnelEnabled` é uma linha por conta. O processo
registra quem ligou (`setTunnelOwner`), e o watchdog reinicia sob essa conta.
Auto-resume no boot só acontece quando existe exatamente **uma** conta.

## Verificação

- `npm run check` (lint + contract + build + typecheck + testes) — 849 testes.
- `npx tsx scripts/db-smoke.ts` — 16 asserções contra o Postgres **real**:
  tradução de placeholder, remap de coluna, `COUNT(*)` como número, precisão de
  `cost`, busca `tsvector`, isolamento entre dois tenants, rollback de
  transação. É a única coisa que exercita o Postgres de verdade; os testes
  unitários mockam o adapter.

## Pendências conhecidas

- **Exclusão de conta.** Nada apaga as linhas de um usuário quando a conta some
  do Neon Auth. `tests/unit/childRowDeletePolicy.test.ts` registra isso na
  entrada `*.userId`.
- **`trusted_origins` vazio** no Neon Auth — o domínio de produção precisa entrar
  antes do deploy.
- **`@neondatabase/auth` está em Beta** segundo a documentação da Neon.
- **3 vulnerabilidades high** relatadas pelo `npm install` das dependências novas
  (`better-auth` + `react-email`), ainda não investigadas.
- **Trabalho não commitado**: a árvore já tinha 12 arquivos modificados e 4 novos
  da feature de CLI Tools quando esta migração começou. Os dois conjuntos estão
  se misturando no mesmo diff.
