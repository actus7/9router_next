# Cloud Deploy para CLIs — Design

Data: 2026-08-28
Status: aprovado para implementação

## Contexto

O squid hoje suporta 14 CLIs (`claude`, `codex`, `opencode`, `droid`, `openclaw`,
`hermes`, `cowork`, `copilot`, `cline`, `kilo`, `deepseek-tui`, `jcode`,
`grok-build`, `devin`) apenas configurando-as para rodar **localmente**,
apontando para o gateway do squid.

O projeto `modelhub` (actus7/modelhub, será depreciado) tem um recurso
equivalente ao "Cloud" que provisiona o **OpenClaw** em Render ou Railway
com um clique, e o usuário acessa o agente por uma URL pública em vez de
rodar localmente. Fonte: `server/lib/cloud/{driver,render,railway}.ts`,
`server/routes/cloud.ts`, `lib/contracts.ts`, `prisma/schema.prisma`
(modelos `CloudConnection`/`CloudDeployment`), `components/dashboard/cloud-section.tsx`.

Objetivo: trazer esse recurso para o squid, generalizado — não fixo em
OpenClaw — e com uma UI própria (não copiar a tela do modelhub), seguindo
os padrões já estabelecidos no squid (SQLite com blob JSON, shadcn,
self-hosted single-user).

## Diferenças de contexto squid vs. modelhub

| | modelhub | squid |
|---|---|---|
| Persistência | Postgres + Prisma, multi-tenant (`userId`) | SQLite, tabelas declarativas com `data: TEXT` JSON + colunas indexadas, single-user |
| Credenciais | Token criptografado (`encryptCredential`) | Texto puro, mesmo padrão de `providerConnections`/`apiKeys` hoje (decisão confirmada com o usuário — sem precedente de criptografia em repouso no squid, DB é local) |
| API | Hono, rotas `server/routes/cloud.ts` | Next.js route handlers, `src/app/api/cloud/**` |
| CLI deployável | Só OpenClaw, hardcoded nos endpoints (`/deployments/:provider/openclaw`) | Qualquer CLI com manifest registrado — só OpenClaw no lançamento (única com imagem pública headless: `ghcr.io/openclaw/openclaw:latest`) |

## Escopo

Dentro do escopo:
- Conectar contas Render/Railway via token (paste + validação), 1 conexão
  por provider.
- Deploy do OpenClaw em Render ou Railway a partir de um manifest de
  ferramenta.
- Listar/atualizar/apagar ambientes provisionados, com refresh de status.
- Registro genérico de "ferramentas deployáveis" (`CloudToolManifest`) para
  que novas CLIs entrem sem mudar rotas/driver/UI.
- Nova página `dashboard/cloud` no menu principal.

Fora do escopo (não fazer agora):
- Deploy de CLIs sem imagem headless pública (Claude Code, Cline, Copilot,
  Droid, Kilo, Devin, etc.) — são ferramentas de terminal/IDE, não serviços
  web. Endereçar apenas quando/se publicarem um modo servidor + imagem.
- Novos provedores de cloud além de Render/Railway (arquitetura já deixa
  espaço via `CloudProviderDriver`, mas implementar só os dois pedidos).
- Criptografia de credenciais em repouso (decisão explícita do usuário).
- OAuth com os provedores — fluxo é paste-de-token, igual ao modelhub.

## Modelo de dados

Duas tabelas novas em `src/lib/db/schema.ts`, seguindo o padrão existente
(`providerConnections`, `proxyPools`): poucas colunas indexadas + um blob
`data: TEXT` para o resto.

```ts
cloudConnections: {
  columns: {
    id: "TEXT PRIMARY KEY",
    provider: "TEXT NOT NULL",       // "render" | "railway"
    label: "TEXT",
    data: "TEXT NOT NULL",           // JSON: { token, externalUserEmail, externalOrgName, externalOrgId }
    createdAt: "TEXT NOT NULL",
    updatedAt: "TEXT NOT NULL",
  },
  indexes: [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_provider ON cloudConnections(provider)",
  ],
},
cloudDeployments: {
  columns: {
    id: "TEXT PRIMARY KEY",
    connectionId: "TEXT NOT NULL",
    provider: "TEXT NOT NULL",
    toolId: "TEXT NOT NULL",         // "openclaw"
    status: "TEXT NOT NULL",         // "provisioning" | "healthy" | "failed" | "deleting"
    publicUrl: "TEXT",
    data: "TEXT NOT NULL",           // JSON: { image, region, instanceType, port, externalServiceId, externalDeployId, gatewayToken, config, error }
    createdAt: "TEXT NOT NULL",
    updatedAt: "TEXT NOT NULL",
  },
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_cd_connection ON cloudDeployments(connectionId)",
    "CREATE INDEX IF NOT EXISTS idx_cd_tool ON cloudDeployments(toolId)",
    "CREATE INDEX IF NOT EXISTS idx_cd_status ON cloudDeployments(status)",
  ],
},
```

`idx_cc_provider` único força "1 conexão por provider" — mesma regra do
modelhub (`@@unique([userId, provider])`), sem a parte de `userId` porque
squid é single-user.

## Registro de ferramentas deployáveis

`src/server/cloud/tools/registry.ts`:

```ts
export type CloudToolManifest = {
  id: string;
  name: string;
  icon: string;
  image: string;
  port: number;
  healthPath: string;
  readyPath?: string;
  buildEnv: (input: {
    gatewayApiUrl: string;
    gatewayApiKey: string;
    model: string;
    provider: string;
    allowedOrigins?: string[];
  }) => Record<string, string>;
};

export const CLOUD_TOOLS: Record<string, CloudToolManifest> = {
  openclaw: {
    id: "openclaw",
    name: "OpenClaw",
    icon: "/providers/openclaw.png",
    image: "ghcr.io/openclaw/openclaw:latest",
    port: 8080, // confirmar porta real do container na implementação
    healthPath: "/health",
    readyPath: "/ready",
    buildEnv: ({ gatewayApiUrl, gatewayApiKey, model, provider, allowedOrigins }) => ({
      MODELHUB_API_URL: gatewayApiUrl, // renomear para variável do squid
      MODELHUB_API_KEY: gatewayApiKey,
      OPENCLAW_MODEL: model,
      OPENCLAW_PROVIDER: provider,
      OPENCLAW_ALLOWED_ORIGINS: (allowedOrigins ?? []).join(","),
    }),
  },
};

export function getCloudTool(toolId: string): CloudToolManifest | null {
  return CLOUD_TOOLS[toolId] ?? null;
}
```

Adicionar uma CLI nova = adicionar uma entrada aqui. Nenhuma rota, driver
ou componente de UI muda.

## Driver de provider cloud

`src/server/cloud/providers/driver.ts` — porta da interface do modelhub,
generalizada (recebe o manifest da ferramenta em vez de assumir OpenClaw):

```ts
export type CloudProvider = "render" | "railway";

export type AccountMetadata = {
  externalUserEmail: string | null;
  externalUserId: string | null;
  externalOrgId: string | null;
  externalOrgName: string | null;
};

export type DeployResult = {
  externalServiceId: string;
  externalDeployId: string | null;
  publicUrl: string | null;
  status: CloudDeploymentStatus;
};

export type RefreshResult = {
  externalDeployId: string | null;
  publicUrl: string | null;
  status: CloudDeploymentStatus;
  error: string | null;
  missing: boolean;
};

export enum CloudProviderErrorType {
  AUTHENTICATION = "authentication",
  FREE_TIER_LIMIT = "free_tier_limit",
  RATE_LIMIT = "rate_limit",
  RESOURCE_NOT_FOUND = "resource_not_found",
  RESOURCE_CONFLICT = "resource_conflict",
  SERVICE_UNAVAILABLE = "service_unavailable",
  INVALID_CONFIGURATION = "invalid_configuration",
  UNKNOWN = "unknown",
}

export class CloudProviderError extends Error {
  constructor(
    public readonly type: CloudProviderErrorType,
    public readonly provider: CloudProvider,
    message: string,
    public readonly originalError?: unknown,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "CloudProviderError";
  }
}

export interface CloudProviderDriver {
  validateToken(token: string): Promise<AccountMetadata>;
  createDeployment(
    token: string,
    tool: CloudToolManifest,
    env: Record<string, string>,
    opts: { region?: string; instanceType?: string },
  ): Promise<DeployResult>;
  updateDeployment(
    token: string,
    externalServiceId: string,
    env: Record<string, string>,
  ): Promise<{ externalDeployId: string | null }>;
  refresh(
    token: string,
    externalServiceId: string,
    externalDeployId: string | null,
  ): Promise<RefreshResult>;
  deleteService(token: string, externalServiceId: string): Promise<"deleted" | "missing">;
  isFreeTierError(error: unknown): boolean;
}

export function formatCloudProviderError(error: CloudProviderError): string {
  // mesmas mensagens pt-BR do modelhub (driver.ts), adaptadas.
}
```

`src/server/cloud/providers/render.ts` e `railway.ts` implementam essa
interface — lógica de chamada de API praticamente igual ao modelhub, só
trocando os dados fixos do OpenClaw (`RENDER_OPENCLAW_IMAGE`, porta, env)
pelos campos vindos de `tool: CloudToolManifest`.

`src/server/cloud/providers/registry.ts`:
```ts
export const CLOUD_PROVIDERS: Record<CloudProvider, CloudProviderDriver> = {
  render: renderDriver,
  railway: railwayDriver,
};
```

## Rotas (`src/app/api/cloud/**`)

```
GET    /api/cloud/connections
POST   /api/cloud/connections/[provider]      body: { token, label? }
DELETE /api/cloud/connections/[id]

GET    /api/cloud/deployments
POST   /api/cloud/deployments                 body: { provider, toolId, region?, instanceType?, config }
POST   /api/cloud/deployments/[id]/refresh
DELETE /api/cloud/deployments/[id]
```

Fluxo de `POST /api/cloud/deployments`:
1. Resolve `connection` por `provider`, `tool` por `toolId` via
   `getCloudTool` (404 se toolId sem manifest).
2. Monta `env` com `tool.buildEnv(...)` usando a base URL/API key do
   gateway do próprio squid.
3. Chama `driver.createDeployment(...)`.
4. Persiste linha em `cloudDeployments` com `status` retornado.
5. Erros de `CloudProviderError` viram resposta HTTP com a mensagem
   amigável de `formatCloudProviderError`.

`refresh` é polling explícito (botão + polling leve client-side, sem
WebSocket novo) — chama `driver.refresh`, atualiza `status`/`publicUrl`/
`error` na tabela.

## UI — `src/app/(dashboard)/dashboard/cloud/`

Página nova, item próprio no menu principal (ao lado de `cli-tools`).

Estrutura:
- `CloudPageClient.tsx` — layout de duas colunas (grid de ferramentas
  deployáveis à esquerda, ambientes provisionados à direita), responsivo
  (colapsa para empilhado em mobile).
- Grid de ferramentas: um card por entrada de `CLOUD_TOOLS` (só OpenClaw
  no lançamento), reaproveitando ícone/nome dos cards já existentes em
  `cli-tools/components`. Badge "Disponível na nuvem" nas que têm manifest;
  as demais 13 CLIs aparecem em `cli-tools` normalmente, sem entrada aqui
  (não temos imagem pra elas).
- Ao selecionar uma ferramenta: painel de provider — dois cards Render/
  Railway com estado conectado/desconectado (dialog shadcn para colar o
  token, com validação e mensagem de erro inline).
- Formulário de deploy: provider, região, modelo/provider de IA (reusa os
  selects que já existem no restante do dashboard), botão "Deploy" com
  estado de loading.
- Lista de ambientes: cards com status (badge colorido), URL pública
  (copiável), ações (refresh, abrir, apagar com confirmação). Skeleton
  enquanto carrega, empty state igual ao mockup mandado mas com o
  visual/tokens do squid, erro por card usando `formatCloudProviderError`.

## Testes

Um `assert`-based check por peça não trivial, sem framework de mocks
pesado (convenção do projeto):
- `cloud/providers/driver.test.ts` — `formatCloudProviderError` cobre
  todos os `CloudProviderErrorType`.
- `cloud/tools/registry.test.ts` — `getCloudTool` retorna manifest válido
  para `"openclaw"` e `null` para id desconhecido.
- Smoke test de rota (`api/cloud/deployments`) com driver mockado
  in-memory (sem chamar Render/Railway de verdade).

## Riscos / pontos em aberto para a implementação

- Porta real e paths de health/ready do container `ghcr.io/openclaw/openclaw`
  precisam ser confirmados (usei os do modelhub como placeholder).
- Nome das env vars do gateway do squid (equivalente a
  `MODELHUB_API_URL`/`MODELHUB_API_KEY`) precisa mapear pro que o squid já
  usa hoje para autenticar CLIs remotamente.
