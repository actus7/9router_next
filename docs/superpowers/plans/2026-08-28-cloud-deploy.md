# Cloud Deploy para CLIs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users provision the CLIs squid already supports (starting with OpenClaw) on Render or Railway with a few clicks, instead of only running them on the local machine.

**Architecture:** A provider-agnostic `CloudProviderDriver` interface (Render + Railway implementations) deploys a `CloudToolManifest` (currently only `openclaw`) that describes the Docker image, port, env vars, and startup script a tool needs. Two new SQLite tables (`cloudConnections`, `cloudDeployments`) persist provider tokens and provisioned environments, following the project's existing `data: TEXT` JSON-blob-plus-indexed-columns pattern. A new `dashboard/cloud` page drives it.

**Tech Stack:** Next.js App Router route handlers, TypeScript, better-sqlite3 (existing `src/lib/db` layer), shadcn/ui, vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-cloud-deploy-design.md`

## Global Constraints

- No credential encryption at rest — tokens stored as plain text in the `data` JSON column, matching `providerConnections`/`apiKeys` today (explicit user decision).
- Single-user app: no `userId` scoping anywhere in this feature.
- Only `openclaw` gets a `CloudToolManifest` in this plan — other CLIs have no headless server image today.
- Follow the existing repo-per-domain pattern in `src/lib/db/repos/` exactly (see `proxyPoolsRepo.ts`) — same `rowToX`/`xToRow`/`upsert` shape.
- All user-facing error text in pt-BR.
- New page lives at `src/app/(dashboard)/dashboard/cloud/`, with its own sidebar entry.

---

## Task 1: Database schema + repositories

**Files:**
- Modify: `src/lib/db/schema.ts` (add `cloudConnections`, `cloudDeployments` to `TABLES`, bump `SCHEMA_VERSION`)
- Create: `src/lib/db/repos/cloudConnectionsRepo.ts`
- Create: `src/lib/db/repos/cloudDeploymentsRepo.ts`
- Modify: `src/lib/db/index.ts` (export the new repo functions)
- Modify: `src/lib/localDb.ts` (re-export for backward-compat, same as every other repo)
- Modify: `src/models/index.ts` (export the new functions)

**Interfaces:**
- Produces (used by Tasks 6-8):
  - `getCloudConnections(): Promise<CloudConnection[]>`
  - `getCloudConnectionByProvider(provider: string): Promise<CloudConnection | null>`
  - `createCloudConnection(data): Promise<CloudConnection>` (upserts by provider)
  - `deleteCloudConnection(id: string): Promise<CloudConnection | null>`
  - `getCloudDeployments(filter?: { toolId?: string; provider?: string }): Promise<CloudDeployment[]>`
  - `getCloudDeploymentById(id: string): Promise<CloudDeployment | null>`
  - `createCloudDeployment(data): Promise<CloudDeployment>`
  - `updateCloudDeployment(id: string, data: Partial<CloudDeployment>): Promise<CloudDeployment | null>`
  - `deleteCloudDeployment(id: string): Promise<CloudDeployment | null>`
  - `CloudConnection = { id, provider, label, createdAt, updatedAt, token, externalUserEmail, externalOrgName, externalOrgId }`
  - `CloudDeployment = { id, connectionId, provider, toolId, status, publicUrl, createdAt, updatedAt, image, region, instanceType, port, externalServiceId, externalDeployId, gatewayToken, config, error }`

- [ ] **Step 1: Add the two tables to the schema**

In `src/lib/db/schema.ts`, bump `SCHEMA_VERSION` to `3` and add to `TABLES`:

```ts
  cloudConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      label: "TEXT",
      data: "TEXT NOT NULL",
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
      toolId: "TEXT NOT NULL",
      status: "TEXT NOT NULL",
      publicUrl: "TEXT",
      data: "TEXT NOT NULL",
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

- [ ] **Step 2: Write `cloudConnectionsRepo.ts`**

```ts
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

interface ConnectionRow {
  id: string;
  provider: string;
  label: string | null;
  data: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudConnection {
  id: string;
  provider: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
  token: string;
  externalUserEmail: string | null;
  externalOrgId: string | null;
  externalOrgName: string | null;
}

function rowToConnection(row: ConnectionRow | undefined): CloudConnection | null {
  if (!row) return null;
  const extra = parseJson(row.data, {}) as Record<string, unknown>;
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    token: (extra.token as string) ?? "",
    externalUserEmail: (extra.externalUserEmail as string) ?? null,
    externalOrgId: (extra.externalOrgId as string) ?? null,
    externalOrgName: (extra.externalOrgName as string) ?? null,
  };
}

function connectionToRow(c: CloudConnection): Record<string, unknown> {
  const { id, provider, label, createdAt, updatedAt, ...rest } = c;
  return {
    id,
    provider,
    label: label ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

interface DbLike {
  run(sql: string, params?: unknown[]): void;
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  transaction(fn: () => void): void;
}

function upsert(db: DbLike, c: CloudConnection): void {
  const r = connectionToRow(c);
  db.run(
    `INSERT INTO cloudConnections(id, provider, label, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider=excluded.provider, label=excluded.label,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.provider, r.label, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getCloudConnections(): Promise<CloudConnection[]> {
  const db = await getAdapter();
  const list = (db.all(`SELECT * FROM cloudConnections`) as unknown as ConnectionRow[])
    .map(rowToConnection)
    .filter((c): c is CloudConnection => c !== null);
  list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return list;
}

export async function getCloudConnectionByProvider(provider: string): Promise<CloudConnection | null> {
  const db = await getAdapter();
  return rowToConnection(db.get(`SELECT * FROM cloudConnections WHERE provider = ?`, [provider]) as ConnectionRow | undefined);
}

export async function getCloudConnectionById(id: string): Promise<CloudConnection | null> {
  const db = await getAdapter();
  return rowToConnection(db.get(`SELECT * FROM cloudConnections WHERE id = ?`, [id]) as ConnectionRow | undefined);
}

interface ConnectionInput {
  provider: string;
  label?: string | null;
  token: string;
  externalUserEmail?: string | null;
  externalOrgId?: string | null;
  externalOrgName?: string | null;
}

export async function createCloudConnection(data: ConnectionInput): Promise<CloudConnection> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  let result!: CloudConnection;
  db.transaction(() => {
    const existing = db.get(`SELECT * FROM cloudConnections WHERE provider = ?`, [data.provider]) as ConnectionRow | undefined;
    const connection: CloudConnection = {
      id: existing?.id ?? uuidv4(),
      provider: data.provider,
      label: data.label ?? null,
      token: data.token,
      externalUserEmail: data.externalUserEmail ?? null,
      externalOrgId: data.externalOrgId ?? null,
      externalOrgName: data.externalOrgName ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    upsert(db, connection);
    result = connection;
  });
  return result;
}

export async function deleteCloudConnection(id: string): Promise<CloudConnection | null> {
  const db = await getAdapter();
  let removed: CloudConnection | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM cloudConnections WHERE id = ?`, [id]) as ConnectionRow | undefined;
    if (!row) return;
    removed = rowToConnection(row);
    db.run(`DELETE FROM cloudConnections WHERE id = ?`, [id]);
  });
  return removed;
}
```

- [ ] **Step 3: Write `cloudDeploymentsRepo.ts`**

```ts
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

interface DeploymentRow {
  id: string;
  connectionId: string;
  provider: string;
  toolId: string;
  status: string;
  publicUrl: string | null;
  data: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudDeployment {
  id: string;
  connectionId: string;
  provider: string;
  toolId: string;
  status: "provisioning" | "healthy" | "failed" | "deleting";
  publicUrl: string | null;
  createdAt: string;
  updatedAt: string;
  image: string;
  region: string;
  instanceType: string;
  port: number;
  externalServiceId: string;
  externalDeployId: string | null;
  gatewayToken: string;
  config: Record<string, unknown>;
  error: string | null;
}

function rowToDeployment(row: DeploymentRow | undefined): CloudDeployment | null {
  if (!row) return null;
  const extra = parseJson(row.data, {}) as Record<string, unknown>;
  return {
    id: row.id,
    connectionId: row.connectionId,
    provider: row.provider,
    toolId: row.toolId,
    status: row.status as CloudDeployment["status"],
    publicUrl: row.publicUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    image: (extra.image as string) ?? "",
    region: (extra.region as string) ?? "",
    instanceType: (extra.instanceType as string) ?? "",
    port: (extra.port as number) ?? 0,
    externalServiceId: (extra.externalServiceId as string) ?? "",
    externalDeployId: (extra.externalDeployId as string | null) ?? null,
    gatewayToken: (extra.gatewayToken as string) ?? "",
    config: (extra.config as Record<string, unknown>) ?? {},
    error: (extra.error as string | null) ?? null,
  };
}

function deploymentToRow(d: CloudDeployment): Record<string, unknown> {
  const { id, connectionId, provider, toolId, status, publicUrl, createdAt, updatedAt, ...rest } = d;
  return {
    id,
    connectionId,
    provider,
    toolId,
    status,
    publicUrl: publicUrl ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

interface DbLike {
  run(sql: string, params?: unknown[]): void;
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  transaction(fn: () => void): void;
}

function upsert(db: DbLike, d: CloudDeployment): void {
  const r = deploymentToRow(d);
  db.run(
    `INSERT INTO cloudDeployments(id, connectionId, provider, toolId, status, publicUrl, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status=excluded.status, publicUrl=excluded.publicUrl,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.connectionId, r.provider, r.toolId, r.status, r.publicUrl, r.data, r.createdAt, r.updatedAt]
  );
}

interface DeploymentFilter {
  toolId?: string;
  provider?: string;
}

export async function getCloudDeployments(filter: DeploymentFilter = {}): Promise<CloudDeployment[]> {
  const db = await getAdapter();
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.toolId) { where.push("toolId = ?"); params.push(filter.toolId); }
  if (filter.provider) { where.push("provider = ?"); params.push(filter.provider); }
  const sql = `SELECT * FROM cloudDeployments${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const list = (db.all(sql, params) as unknown as DeploymentRow[])
    .map(rowToDeployment)
    .filter((d): d is CloudDeployment => d !== null);
  list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return list;
}

export async function getCloudDeploymentById(id: string): Promise<CloudDeployment | null> {
  const db = await getAdapter();
  return rowToDeployment(db.get(`SELECT * FROM cloudDeployments WHERE id = ?`, [id]) as DeploymentRow | undefined);
}

interface DeploymentInput {
  connectionId: string;
  provider: string;
  toolId: string;
  status: CloudDeployment["status"];
  publicUrl?: string | null;
  image: string;
  region: string;
  instanceType: string;
  port: number;
  externalServiceId: string;
  externalDeployId?: string | null;
  gatewayToken: string;
  config?: Record<string, unknown>;
  error?: string | null;
}

export async function createCloudDeployment(data: DeploymentInput): Promise<CloudDeployment> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const deployment: CloudDeployment = {
    id: uuidv4(),
    connectionId: data.connectionId,
    provider: data.provider,
    toolId: data.toolId,
    status: data.status,
    publicUrl: data.publicUrl ?? null,
    image: data.image,
    region: data.region,
    instanceType: data.instanceType,
    port: data.port,
    externalServiceId: data.externalServiceId,
    externalDeployId: data.externalDeployId ?? null,
    gatewayToken: data.gatewayToken,
    config: data.config ?? {},
    error: data.error ?? null,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, deployment);
  return deployment;
}

export async function updateCloudDeployment(id: string, data: Partial<CloudDeployment>): Promise<CloudDeployment | null> {
  const db = await getAdapter();
  let result: CloudDeployment | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM cloudDeployments WHERE id = ?`, [id]) as DeploymentRow | undefined;
    if (!row) return;
    const merged: CloudDeployment = { ...rowToDeployment(row)!, ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteCloudDeployment(id: string): Promise<CloudDeployment | null> {
  const db = await getAdapter();
  let removed: CloudDeployment | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM cloudDeployments WHERE id = ?`, [id]) as DeploymentRow | undefined;
    if (!row) return;
    removed = rowToDeployment(row);
    db.run(`DELETE FROM cloudDeployments WHERE id = ?`, [id]);
  });
  return removed;
}
```

- [ ] **Step 4: Wire the barrels**

In `src/lib/db/index.ts`, add:

```ts
// Cloud deploy
export {
  getCloudConnections, getCloudConnectionByProvider, getCloudConnectionById,
  createCloudConnection, deleteCloudConnection,
} from "./repos/cloudConnectionsRepo";
export {
  getCloudDeployments, getCloudDeploymentById,
  createCloudDeployment, updateCloudDeployment, deleteCloudDeployment,
} from "./repos/cloudDeploymentsRepo";
```

In `src/lib/localDb.ts`, add the same names to the existing `export { ... } from "@/lib/db/index"` block.

In `src/models/index.ts`, add the same names to the existing `export { ... } from "@/lib/localDb"` block.

- [ ] **Step 5: Typecheck**

Run: `npm run check` (or `npx tsc --noEmit` if `check` doesn't exist — confirm via `package.json` scripts first)
Expected: no new type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/repos/cloudConnectionsRepo.ts src/lib/db/repos/cloudDeploymentsRepo.ts src/lib/db/index.ts src/lib/localDb.ts src/models/index.ts
git commit -m "feat: add cloudConnections/cloudDeployments tables and repos"
```

---

## Task 2: Cloud tool manifest registry (OpenClaw)

**Files:**
- Create: `src/server/cloud/tools/types.ts`
- Create: `src/server/cloud/tools/openclaw.ts`
- Create: `src/server/cloud/tools/registry.ts`
- Test: `tests/unit/cloudToolRegistry.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module)
- Produces (used by Tasks 3-8):
  - `CloudToolManifest`, `CloudToolStartup`, `CloudToolEnvInput`, `CloudToolInfo` (types)
  - `CLOUD_TOOLS: Record<string, CloudToolManifest>`
  - `getCloudTool(toolId: string): CloudToolManifest | null`
  - `listCloudTools(): CloudToolManifest[]`

- [ ] **Step 1: Write `types.ts`**

```ts
export type CloudToolStartup = {
  configEnvVar: string;
  configPath: string;
  runArgs: string[];
};

export type CloudToolEnvInput = {
  gatewayToken: string;
  gatewayApiUrl: string;
  gatewayApiKey: string;
  model: string;
  provider: string;
  serviceUrl: string;
  allowedOrigins?: string[];
};

export type CloudToolInfo = {
  allowedOrigins: string[];
  controlUiUrl: string;
  healthUrl: string;
  readyUrl: string;
  webSocketUrl: string;
  model: string;
  provider: string;
};

export type CloudToolManifest = {
  id: string;
  name: string;
  icon: string;
  image: string;
  port: number;
  startup: CloudToolStartup;
  buildEnv: (input: CloudToolEnvInput) => Array<{ key: string; value: string }>;
  buildInfo: (input: CloudToolEnvInput) => CloudToolInfo;
};
```

- [ ] **Step 2: Write `openclaw.ts`**

```ts
import type { CloudToolManifest, CloudToolEnvInput, CloudToolInfo } from "./types";

const OPENCLAW_PORT = 10000;
const OPENCLAW_CONFIG_PATH = "/tmp/openclaw-state/openclaw.json";
const OPENCLAW_AGENT_TIMEOUT_SECONDS = 610;
const OPENCLAW_PROVIDER_TIMEOUT_SECONDS = 600;

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function uniqueOrigins(origins: string[]): string[] {
  return Array.from(new Set(origins.map(normalizeOrigin).filter((o): o is string => !!o)));
}

function webSocketUrlFromServiceUrl(serviceUrl: string): string {
  const origin = normalizeOrigin(serviceUrl) ?? serviceUrl;
  return origin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

function buildInfo(input: CloudToolEnvInput): CloudToolInfo {
  const serviceOrigin = normalizeOrigin(input.serviceUrl) ?? input.serviceUrl;
  const gatewayOrigin = normalizeOrigin(input.gatewayApiUrl) ?? input.gatewayApiUrl;
  const allowedOrigins = uniqueOrigins([serviceOrigin, gatewayOrigin, ...(input.allowedOrigins ?? [])]);
  return {
    allowedOrigins,
    controlUiUrl: serviceOrigin,
    healthUrl: `${serviceOrigin}/healthz`,
    readyUrl: `${serviceOrigin}/readyz`,
    webSocketUrl: webSocketUrlFromServiceUrl(serviceOrigin),
    model: input.model,
    provider: input.provider,
  };
}

function buildRuntimeConfig(input: CloudToolEnvInput): Record<string, unknown> {
  const info = buildInfo(input);
  const modelReference = `squid/${info.model}`;
  return {
    agents: {
      defaults: {
        model: { primary: modelReference },
        models: { [modelReference]: { alias: info.model } },
        timeoutSeconds: OPENCLAW_AGENT_TIMEOUT_SECONDS,
      },
    },
    gateway: {
      auth: { mode: "token", token: "${OPENCLAW_GATEWAY_TOKEN}" },
      bind: "lan",
      controlUi: { allowedOrigins: info.allowedOrigins },
      http: { endpoints: { chatCompletions: { enabled: true } } },
      mode: "local",
      port: OPENCLAW_PORT,
    },
    models: {
      mode: "merge",
      providers: {
        squid: {
          api: "openai-completions",
          apiKey: "${OPENAI_API_KEY}",
          baseUrl: input.gatewayApiUrl,
          timeoutSeconds: OPENCLAW_PROVIDER_TIMEOUT_SECONDS,
          models: [{ contextWindow: 128000, id: info.model, input: ["text"], maxTokens: 32000, name: info.model }],
        },
      },
    },
    update: { checkOnStart: false },
    // Free-tier footprint reduction: keep the browser plugin but disable the
    // heaviest non-essential ones so a 512MB instance doesn't OOM.
    plugins: {
      entries: {
        canvas: { enabled: false },
        "phone-control": { enabled: false },
        "talk-voice": { enabled: false },
      },
    },
  };
}

function buildEnv(input: CloudToolEnvInput): Array<{ key: string; value: string }> {
  const info = buildInfo(input);
  return [
    { key: "OPENCLAW_GATEWAY_PORT", value: String(OPENCLAW_PORT) },
    { key: "OPENCLAW_GATEWAY_TOKEN", value: input.gatewayToken },
    { key: "OPENAI_API_KEY", value: input.gatewayApiKey },
    { key: "OPENAI_BASE_URL", value: input.gatewayApiUrl },
    { key: "OPENCLAW_CONFIG_PATH", value: OPENCLAW_CONFIG_PATH },
    { key: "OPENCLAW_NO_AUTO_UPDATE", value: "1" },
    { key: "OPENCLAW_STATE_DIR", value: "/tmp/openclaw-state" },
    { key: "OPENCLAW_WORKSPACE_DIR", value: "/tmp/openclaw-workspace" },
    { key: "OPENCLAW_CONFIG_JSON", value: JSON.stringify(buildRuntimeConfig(input)) },
    { key: "OPENCLAW_ALLOWED_ORIGINS", value: info.allowedOrigins.join(",") },
    { key: "OPENCLAW_CONTROL_UI_URL", value: info.controlUiUrl },
  ];
}

export const openclawManifest: CloudToolManifest = {
  id: "openclaw",
  name: "OpenClaw",
  icon: "/providers/openclaw.png",
  image: "ghcr.io/openclaw/openclaw:latest",
  port: OPENCLAW_PORT,
  startup: {
    configEnvVar: "OPENCLAW_CONFIG_JSON",
    configPath: OPENCLAW_CONFIG_PATH,
    runArgs: ["openclaw.mjs", "gateway", "run", "--bind", "lan"],
  },
  buildEnv,
  buildInfo,
};
```

- [ ] **Step 3: Write `registry.ts`**

```ts
import type { CloudToolManifest } from "./types";
import { openclawManifest } from "./openclaw";

export const CLOUD_TOOLS: Record<string, CloudToolManifest> = {
  openclaw: openclawManifest,
};

export function getCloudTool(toolId: string): CloudToolManifest | null {
  return CLOUD_TOOLS[toolId] ?? null;
}

export function listCloudTools(): CloudToolManifest[] {
  return Object.values(CLOUD_TOOLS);
}

export type { CloudToolManifest, CloudToolStartup, CloudToolEnvInput, CloudToolInfo } from "./types";
```

- [ ] **Step 4: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { getCloudTool, listCloudTools } from "@/server/cloud/tools/registry";

describe("cloud tool registry", () => {
  it("resolves the openclaw manifest by id", () => {
    const tool = getCloudTool("openclaw");
    expect(tool?.id).toBe("openclaw");
    expect(tool?.image).toBe("ghcr.io/openclaw/openclaw:latest");
  });

  it("returns null for an unknown tool id", () => {
    expect(getCloudTool("does-not-exist")).toBeNull();
  });

  it("lists at least the openclaw tool", () => {
    expect(listCloudTools().some((t) => t.id === "openclaw")).toBe(true);
  });

  it("builds env vars containing the gateway token and api url", () => {
    const tool = getCloudTool("openclaw")!;
    const env = tool.buildEnv({
      gatewayToken: "tok123",
      gatewayApiUrl: "https://squid.example.com/v1",
      gatewayApiKey: "sk-test",
      model: "gpt-4o",
      provider: "openai",
      serviceUrl: "https://squid-openclaw.onrender.com",
    });
    expect(env.find((e) => e.key === "OPENCLAW_GATEWAY_TOKEN")?.value).toBe("tok123");
    expect(env.find((e) => e.key === "OPENAI_BASE_URL")?.value).toBe("https://squid.example.com/v1");
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run tests/unit/cloudToolRegistry.test.ts`
Expected: FAIL — `Cannot find module '@/server/cloud/tools/registry'`

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/cloudToolRegistry.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add src/server/cloud/tools tests/unit/cloudToolRegistry.test.ts
git commit -m "feat: add cloud tool manifest registry with OpenClaw"
```

---

## Task 3: Provider driver interface + error formatting

**Files:**
- Create: `src/server/cloud/providers/driver.ts`
- Test: `tests/unit/cloudProviderDriver.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces (used by Tasks 4, 5, 6, 8):
  - `CloudProvider = "render" | "railway"`
  - `CloudDeploymentStatus = "provisioning" | "healthy" | "failed" | "deleting"`
  - `AccountMetadata`, `DeployResult`, `UpdateResult`, `RefreshResult`
  - `CloudProviderErrorType` enum, `CloudProviderError` class, `isCloudProviderError`
  - `CloudProviderDriver` interface
  - `formatCloudProviderError(error: CloudProviderError): string`
  - `generateResourceName(toolId: string): string`

- [ ] **Step 1: Write `driver.ts`**

```ts
import type { CloudToolManifest, CloudToolEnvInput } from "../tools/types";

export type CloudProvider = "render" | "railway";
export type CloudDeploymentStatus = "provisioning" | "healthy" | "failed" | "deleting";

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
  gatewayToken: string;
};

export type UpdateResult = {
  externalDeployId: string | null;
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

export function isCloudProviderError(error: unknown): error is CloudProviderError {
  return error instanceof CloudProviderError;
}

export interface CloudProviderDriver {
  validateToken(token: string): Promise<AccountMetadata>;
  createDeployment(
    token: string,
    resourceName: string,
    tool: CloudToolManifest,
    env: CloudToolEnvInput,
  ): Promise<DeployResult>;
  updateDeployment(
    token: string,
    externalServiceId: string,
    tool: CloudToolManifest,
    env: CloudToolEnvInput,
  ): Promise<UpdateResult>;
  refresh(
    token: string,
    externalServiceId: string,
    externalDeployId: string | null,
  ): Promise<RefreshResult>;
  deleteService(token: string, externalServiceId: string): Promise<"deleted" | "missing">;
  isFreeTierError(error: unknown): boolean;
}

export function formatCloudProviderError(error: CloudProviderError): string {
  switch (error.type) {
    case CloudProviderErrorType.AUTHENTICATION:
      return `Token ${error.provider} inválido ou expirado. Verifique suas credenciais.`;
    case CloudProviderErrorType.FREE_TIER_LIMIT:
      return error.provider === "render"
        ? "Limite do plano gratuito do Render atingido. Considere upgrade para o plano Starter ($7/mês)."
        : "Limite do plano gratuito do Railway atingido (créditos ou número de recursos). Faça upgrade do plano, adicione método de pagamento ou remova projetos/serviços existentes no Railway.";
    case CloudProviderErrorType.RATE_LIMIT: {
      const retry = error.retryAfterMs
        ? ` Tente novamente em ${Math.ceil(error.retryAfterMs / 1000)} segundos.`
        : " Tente novamente em alguns segundos.";
      return `Rate limit atingido no ${error.provider}.${retry}`;
    }
    case CloudProviderErrorType.RESOURCE_NOT_FOUND:
      return `Recurso não encontrado no ${error.provider}. O serviço pode ter sido deletado externamente.`;
    case CloudProviderErrorType.RESOURCE_CONFLICT:
      return `Conflito de recursos no ${error.provider}. O serviço pode já existir.`;
    case CloudProviderErrorType.SERVICE_UNAVAILABLE:
      return `Serviço ${error.provider} temporariamente indisponível. Tente novamente em alguns minutos.`;
    case CloudProviderErrorType.INVALID_CONFIGURATION:
      return `Configuração inválida para ${error.provider}: ${error.message}`;
    default:
      return `Erro no ${error.provider}: ${error.message}`;
  }
}

export function generateResourceName(toolId: string): string {
  return `squid-${toolId}`;
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  CloudProviderError, CloudProviderErrorType, formatCloudProviderError, generateResourceName,
} from "@/server/cloud/providers/driver";

describe("formatCloudProviderError", () => {
  it("covers every CloudProviderErrorType with a pt-BR message", () => {
    for (const type of Object.values(CloudProviderErrorType)) {
      const error = new CloudProviderError(type, "render", "raw message");
      const message = formatCloudProviderError(error);
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("includes the retry delay for rate limit errors", () => {
    const error = new CloudProviderError(CloudProviderErrorType.RATE_LIMIT, "railway", "rate limited", undefined, 4000);
    expect(formatCloudProviderError(error)).toContain("4 segundos");
  });
});

describe("generateResourceName", () => {
  it("prefixes the tool id with squid-", () => {
    expect(generateResourceName("openclaw")).toBe("squid-openclaw");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/cloudProviderDriver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/cloudProviderDriver.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/cloud/providers/driver.ts tests/unit/cloudProviderDriver.test.ts
git commit -m "feat: add CloudProviderDriver interface and error formatting"
```

---

## Task 4: Render provider driver

**Files:**
- Create: `src/server/cloud/providers/render.ts`

**Interfaces:**
- Consumes: `CloudProviderDriver`, `CloudProviderError`, `CloudProviderErrorType` from Task 3 (`../driver`); `CloudToolManifest`, `CloudToolEnvInput` from Task 2 (`../tools/types`)
- Produces (used by Task 6): `export const renderDriver: CloudProviderDriver`

- [ ] **Step 1: Write `render.ts`**

```ts
import type { CloudToolManifest, CloudToolEnvInput, CloudToolStartup } from "../tools/types";
import type { CloudProviderDriver, AccountMetadata, DeployResult, UpdateResult, RefreshResult, CloudDeploymentStatus } from "./driver";
import { CloudProviderError, CloudProviderErrorType } from "./driver";

const RENDER_API_BASE = "https://api.render.com/v1";
const RENDER_REGION = "oregon";
const RENDER_PLAN = "free";

class RenderApiError extends Error {
  responseBody: unknown;
  status: number;
  constructor(input: { message: string; responseBody?: unknown; status: number }) {
    super(input.message);
    this.name = "RenderApiError";
    this.responseBody = input.responseBody;
    this.status = input.status;
  }
}

type RenderOwner = { email?: string; id?: string; name?: string };
type RenderServiceDetails = { plan?: string; region?: string; url?: string };
type RenderService = { id?: string; name?: string; serviceDetails?: RenderServiceDetails; suspended?: string };
type RenderDeploy = { id?: string; status?: string };

function extractErrorMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) {
    const msg = (body as { message?: string }).message;
    if (msg) return msg;
  }
  return "Render API request failed";
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function renderRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetch(`${RENDER_API_BASE}${path}`, { ...init, headers });
  if (response.status === 204) return null as T;

  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw new RenderApiError({ message: extractErrorMessage(body), responseBody: body, status: response.status });
  }
  return body as T;
}

function mapRenderDeployStatus(deployStatus: string | undefined, suspended: string | undefined): { error: string | null; status: CloudDeploymentStatus } {
  if (deployStatus === "live") return { error: null, status: "healthy" };
  if (deployStatus === "build_failed" || deployStatus === "update_failed" || deployStatus === "pre_deploy_failed") {
    return { error: "O deploy falhou no Render.", status: "failed" };
  }
  if (deployStatus === "canceled") return { error: "O deploy foi cancelado no Render.", status: "failed" };
  if (deployStatus === "deactivated") {
    if (suspended === "suspended") return { error: null, status: "healthy" };
    return { error: "O serviço foi desativado no Render.", status: "failed" };
  }
  return { error: null, status: "provisioning" };
}

function isRenderFreeTierError(error: unknown): boolean {
  if (!(error instanceof RenderApiError)) return false;
  if (![400, 402, 403, 409, 422].includes(error.status)) return false;
  const text = `${error.message} ${JSON.stringify(error.responseBody ?? "")}`.toLowerCase();
  return ["free", "quota", "limit", "plan", "upgrade", "payment"].some((k) => text.includes(k));
}

async function requireRenderOwner(token: string): Promise<RenderOwner & { id: string }> {
  type OwnerItem = { owner?: RenderOwner };
  const items = await renderRequest<OwnerItem[]>(token, "/owners?limit=1");
  const owner = items?.[0]?.owner;
  if (!owner?.id) throw new RenderApiError({ message: "Nenhum workspace acessível com este token.", status: 403 });
  return owner as RenderOwner & { id: string };
}

async function findExistingService(token: string, name: string): Promise<RenderService | null> {
  try {
    const raw = await renderRequest<unknown>(token, "/services?limit=100");
    const items = Array.isArray(raw) ? raw : [];
    for (const item of items) {
      const record = item as Record<string, unknown>;
      const service = (record.service as RenderService | undefined) ?? (record as RenderService);
      if (service?.name === name && service?.id) return service;
    }
    return null;
  } catch {
    return null;
  }
}

// Render runs the Docker Command by splitting on whitespace and exec'ing
// directly (no shell). So the script must be a single argument with no
// spaces: a `node -e <script>` where the script embeds the config path as a
// JSON string literal (guaranteed no spaces for our paths) and writes the
// tool's config JSON (read from its env var) to that path before exec'ing
// the tool's run command.
function buildRenderDockerCommand(startup: CloudToolStartup): string {
  const script = [
    `require('node:fs').mkdirSync(require('node:path').dirname(${JSON.stringify(startup.configPath)}),{recursive:true})`,
    `require('node:fs').writeFileSync(${JSON.stringify(startup.configPath)},process.env.${startup.configEnvVar}||'{}')`,
    `process.exit(require('node:child_process').spawnSync(process.execPath,${JSON.stringify(startup.runArgs)},{stdio:'inherit'}).status||0)`,
  ].join(";");
  return `node -e ${script}`;
}

function toRenderError(error: unknown, fallbackType: CloudProviderErrorType = CloudProviderErrorType.SERVICE_UNAVAILABLE): CloudProviderError {
  if (error instanceof RenderApiError) {
    const type = isRenderFreeTierError(error)
      ? CloudProviderErrorType.FREE_TIER_LIMIT
      : error.status === 401 || error.status === 403
        ? CloudProviderErrorType.AUTHENTICATION
        : error.status === 404
          ? CloudProviderErrorType.RESOURCE_NOT_FOUND
          : error.status === 409
            ? CloudProviderErrorType.RESOURCE_CONFLICT
            : fallbackType;
    return new CloudProviderError(type, "render", error.message, error);
  }
  return new CloudProviderError(CloudProviderErrorType.UNKNOWN, "render", error instanceof Error ? error.message : "Unknown error", error);
}

export const renderDriver: CloudProviderDriver = {
  async validateToken(token: string): Promise<AccountMetadata> {
    try {
      const owner = await requireRenderOwner(token);
      return {
        externalUserEmail: owner.email ?? null,
        externalUserId: owner.id,
        externalOrgId: owner.id,
        externalOrgName: owner.name ?? null,
      };
    } catch (error) {
      throw toRenderError(error, CloudProviderErrorType.AUTHENTICATION);
    }
  },

  async createDeployment(token: string, resourceName: string, tool: CloudToolManifest, env: CloudToolEnvInput): Promise<DeployResult> {
    try {
      const owner = await requireRenderOwner(token);
      const plannedServiceUrl = `https://${resourceName}.onrender.com`;
      const fullEnv: CloudToolEnvInput = { ...env, serviceUrl: plannedServiceUrl };
      const envVars = tool.buildEnv(fullEnv);
      const dockerCommand = buildRenderDockerCommand(tool.startup);

      const existing = await findExistingService(token, resourceName);
      if (existing?.id) {
        const existingId = encodeURIComponent(existing.id);
        await renderRequest(token, `/services/${existingId}/env-vars`, { body: JSON.stringify(envVars), method: "PUT" });
        await renderRequest(token, `/services/${existingId}`, {
          body: JSON.stringify({ serviceDetails: { envSpecificDetails: { dockerCommand }, healthCheckPath: "", runtime: "image" } }),
          method: "PATCH",
        });
        type DeployResponse = { deploy?: { id?: string } } | { id?: string };
        const deployReply = await renderRequest<DeployResponse>(token, `/services/${existingId}/deploys`, {
          body: JSON.stringify({ clearCache: "do_not_clear" }), method: "POST",
        });
        const deployId = ("deploy" in deployReply ? deployReply.deploy?.id : (deployReply as { id?: string }).id) ?? null;
        return {
          externalServiceId: existing.id,
          externalDeployId: deployId,
          publicUrl: existing.serviceDetails?.url ?? plannedServiceUrl,
          status: "provisioning",
          gatewayToken: env.gatewayToken,
        };
      }

      type CreateResponse = { deployId?: string; service?: RenderService };
      const reply = await renderRequest<CreateResponse>(token, "/services", {
        body: JSON.stringify({
          envVars,
          image: { imagePath: tool.image, ownerId: owner.id },
          name: resourceName,
          ownerId: owner.id,
          serviceDetails: {
            envSpecificDetails: { dockerCommand },
            healthCheckPath: "",
            plan: RENDER_PLAN,
            region: RENDER_REGION,
            runtime: "image",
          },
          type: "web_service",
        }),
        method: "POST",
      });

      const service = reply.service;
      if (!service?.id || !service?.name) {
        throw new RenderApiError({ message: "Render não retornou um ID de serviço.", status: 502 });
      }

      return {
        externalServiceId: service.id,
        externalDeployId: reply.deployId ?? null,
        publicUrl: service.serviceDetails?.url ?? plannedServiceUrl,
        status: "provisioning",
        gatewayToken: env.gatewayToken,
      };
    } catch (error) {
      throw toRenderError(error);
    }
  },

  async updateDeployment(token: string, externalServiceId: string, tool: CloudToolManifest, env: CloudToolEnvInput): Promise<UpdateResult> {
    try {
      const id = encodeURIComponent(externalServiceId);
      const envVars = tool.buildEnv(env);
      const dockerCommand = buildRenderDockerCommand(tool.startup);
      await renderRequest(token, `/services/${id}/env-vars`, { body: JSON.stringify(envVars), method: "PUT" });
      await renderRequest(token, `/services/${id}`, {
        body: JSON.stringify({ serviceDetails: { envSpecificDetails: { dockerCommand }, healthCheckPath: "", runtime: "image" } }),
        method: "PATCH",
      });
      type DeployResponse = { deploy?: { id?: string } } | { id?: string };
      const deployReply = await renderRequest<DeployResponse>(token, `/services/${id}/deploys`, {
        body: JSON.stringify({ clearCache: "do_not_clear" }), method: "POST",
      });
      return { externalDeployId: ("deploy" in deployReply ? deployReply.deploy?.id : (deployReply as { id?: string }).id) ?? null };
    } catch (error) {
      throw toRenderError(error);
    }
  },

  async refresh(token: string, externalServiceId: string, externalDeployId: string | null): Promise<RefreshResult> {
    try {
      const id = encodeURIComponent(externalServiceId);
      const service = await renderRequest<RenderService>(token, `/services/${id}`);
      type DeployItem = { deploy?: RenderDeploy };
      let latestDeploy: RenderDeploy | undefined;
      try {
        const deployItems = await renderRequest<DeployItem[]>(token, `/services/${id}/deploys?limit=1`);
        latestDeploy = deployItems?.[0]?.deploy;
      } catch {
        // Deploy list may fail right after creation — non-fatal.
      }
      const mapped = mapRenderDeployStatus(latestDeploy?.status, service.suspended);
      return {
        externalDeployId: latestDeploy?.id ?? externalDeployId,
        error: mapped.error,
        missing: false,
        publicUrl: service.serviceDetails?.url ?? null,
        status: mapped.status,
      };
    } catch (error) {
      if (error instanceof RenderApiError && error.status === 404) {
        return { externalDeployId, error: null, missing: true, publicUrl: null, status: "failed" };
      }
      throw toRenderError(error);
    }
  },

  async deleteService(token: string, externalServiceId: string): Promise<"deleted" | "missing"> {
    try {
      await renderRequest(token, `/services/${encodeURIComponent(externalServiceId)}`, { method: "DELETE" });
      return "deleted";
    } catch (error) {
      if (error instanceof RenderApiError && error.status === 404) return "missing";
      throw toRenderError(error);
    }
  },

  isFreeTierError: isRenderFreeTierError,
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: no new type errors. (No unit test here — this module makes live HTTP calls to Render; it's exercised through Task 8's route smoke test with a mocked driver and through manual QA in Task 10.)

- [ ] **Step 3: Commit**

```bash
git add src/server/cloud/providers/render.ts
git commit -m "feat: add generalized Render cloud provider driver"
```

---

## Task 5: Railway provider driver

**Files:**
- Create: `src/server/cloud/providers/railway.ts`

**Interfaces:**
- Consumes: `CloudProviderDriver`, `CloudProviderError`, `CloudProviderErrorType`, `generateResourceName` from Task 3 (`./driver`); `CloudToolManifest`, `CloudToolEnvInput`, `CloudToolStartup` from Task 2 (`../tools/types`)
- Produces (used by Task 6): `export const railwayDriver: CloudProviderDriver`

- [ ] **Step 1: Write `railway.ts`**

```ts
import type { CloudToolManifest, CloudToolEnvInput, CloudToolStartup } from "../tools/types";
import type { CloudProviderDriver, AccountMetadata, DeployResult, UpdateResult, RefreshResult, CloudDeploymentStatus } from "./driver";
import { CloudProviderError, CloudProviderErrorType } from "./driver";

const RAILWAY_API_BASE = "https://backboard.railway.app/graphql/v2";
const RAILWAY_PORT_FALLBACK = 10000;

type RailwayUser = { id: string; name?: string; email?: string };
type RailwayProject = { id: string; name: string };
type RailwayEnvironment = { id: string; name: string };
type RailwayService = { id: string; name: string };
type RailwayDeployment = { id: string; status: string; url?: string; createdAt: string };

async function railwayRequest<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(RAILWAY_API_BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new CloudProviderError(
      response.status === 401 ? CloudProviderErrorType.AUTHENTICATION : CloudProviderErrorType.SERVICE_UNAVAILABLE,
      "railway",
      `Railway API error: ${response.status} ${response.statusText} — ${body}`,
    );
  }

  const result = await response.json();
  if (result.errors) {
    const isAuth = (result.errors as Array<{ message?: string }>).some((err) => {
      const msg = (err.message ?? "").toLowerCase();
      return msg.includes("unauthorized") || msg.includes("not authorized") || msg.includes("authentication") || msg.includes("forbidden");
    });
    throw new CloudProviderError(
      isAuth ? CloudProviderErrorType.AUTHENTICATION : CloudProviderErrorType.UNKNOWN,
      "railway",
      `Railway GraphQL errors: ${JSON.stringify(result.errors)}`,
    );
  }
  return result.data;
}

const VALIDATE_TOKEN_QUERY = `query ValidateToken { me { id name email } }`;
const LIST_WORKSPACES_QUERY = `query ListWorkspaces { me { workspaces { id name } } }`;
const LIST_PROJECTS_QUERY = `query ListProjects { me { projects { edges { node { id name } } } } }`;
const CREATE_PROJECT_MUTATION = `mutation CreateProject($input: ProjectCreateInput!) { projectCreate(input: $input) { id name } }`;
const GET_PROJECT_ENVIRONMENTS_QUERY = `query GetProjectEnvironments($projectId: String!) { project(id: $projectId) { environments { edges { node { id name } } } } }`;
const CREATE_SERVICE_MUTATION = `mutation CreateService($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }`;
const UPSERT_VARIABLES_MUTATION = `mutation UpsertVariables($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`;
const UPDATE_SERVICE_INSTANCE_MUTATION = `mutation UpdateServiceInstance($serviceId: String!, $environmentId: String, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }`;
const CREATE_SERVICE_DOMAIN_MUTATION = `mutation CreateServiceDomain($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }`;
const TRIGGER_DEPLOY_MUTATION = `mutation TriggerDeploy($input: EnvironmentTriggersDeployInput!) { environmentTriggersDeploy(input: $input) }`;
const GET_DEPLOYMENT_QUERY = `query GetDeployment($id: String!) { deployment(id: $id) { id status createdAt url } }`;
const LIST_SERVICE_DEPLOYMENTS_QUERY = `query ListServiceDeployments($serviceId: String!, $environmentId: String!) { deployments(first: 1, input: { serviceId: $serviceId, environmentId: $environmentId }) { edges { node { id status createdAt url } } } }`;
const GET_SERVICE_URL_QUERY = `query GetServiceUrl($id: String!) { service(id: $id) { id serviceInstances { edges { node { environmentId domains { serviceDomains { domain } } } } } } }`;
const DELETE_SERVICE_MUTATION = `mutation DeleteService($id: String!) { serviceDelete(id: $id) }`;
const DELETE_PROJECT_MUTATION = `mutation DeleteProject($id: String!) { projectDelete(id: $id) }`;

function mapRailwayDeploymentStatus(status: string): { status: CloudDeploymentStatus; error: string | null } {
  switch (status?.toLowerCase()) {
    case "success":
    case "active":
      return { status: "healthy", error: null };
    case "queued":
    case "building":
    case "deploying":
      return { status: "provisioning", error: null };
    case "failed":
    case "crashed":
    case "removed":
      return { status: "failed", error: "Deploy falhou no Railway." };
    case "sleeping":
    case "skipped":
      return { status: "healthy", error: null };
    default:
      return { status: "provisioning", error: null };
  }
}

function isRailwayFreeTierError(error: unknown): boolean {
  if (!(error instanceof CloudProviderError)) return false;
  const text = `${error.message} ${error.originalError ? JSON.stringify(error.originalError) : ""}`.toLowerCase();
  return ["credit", "credits", "limit", "quota", "plan", "upgrade", "billing", "payment"].some((k) => text.includes(k));
}

// Railway validates the start command as a Docker exec form; `sh -c` with
// single quotes avoids shell-escaping issues since the JSON config may
// contain double quotes. `printf` (not `echo`) handles arbitrary content
// safely. Mirrors buildRenderDockerCommand's intent for the shell dialect
// Railway actually runs.
function buildRailwayStartCommand(startup: CloudToolStartup): string {
  const args = startup.runArgs.join(" ");
  return `sh -c 'mkdir -p $(dirname ${startup.configPath}) && printf "%s" "$${startup.configEnvVar}" > ${startup.configPath} && exec node ${args}'`;
}

function toRailwayError(error: unknown): CloudProviderError {
  if (error instanceof CloudProviderError) return error;
  return new CloudProviderError(CloudProviderErrorType.UNKNOWN, "railway", error instanceof Error ? error.message : "Unknown error", error);
}

async function createRailwayDeployment(token: string, resourceName: string, tool: CloudToolManifest, env: CloudToolEnvInput): Promise<DeployResult> {
  await railwayRequest<{ me: RailwayUser }>(token, VALIDATE_TOKEN_QUERY);

  let workspaceId: string | undefined;
  try {
    const ws = await railwayRequest<{ me: { workspaces: Array<{ id: string; name: string }> } }>(token, LIST_WORKSPACES_QUERY);
    workspaceId = ws.me.workspaces?.[0]?.id;
  } catch {
    // Optional for personal accounts.
  }

  const projects = await railwayRequest<{ me: { projects: { edges: Array<{ node: RailwayProject }> } } }>(token, LIST_PROJECTS_QUERY);
  let projectId: string;
  const existingProject = projects?.me?.projects?.edges?.find((e) => e?.node?.name === resourceName);
  if (existingProject) {
    projectId = existingProject.node.id;
  } else {
    const created = await railwayRequest<{ projectCreate: RailwayProject }>(token, CREATE_PROJECT_MUTATION, {
      input: workspaceId ? { name: resourceName, workspaceId } : { name: resourceName },
    });
    projectId = created.projectCreate.id;
  }

  const environments = await railwayRequest<{ project: { environments: { edges: Array<{ node: RailwayEnvironment }> } } }>(
    token, GET_PROJECT_ENVIRONMENTS_QUERY, { projectId },
  );
  const productionEnv = environments?.project?.environments?.edges?.find((e) => e?.node?.name?.toLowerCase() === "production");
  if (!productionEnv) {
    throw new CloudProviderError(CloudProviderErrorType.RESOURCE_NOT_FOUND, "railway", "Environment 'production' não encontrado no projeto Railway.");
  }
  const environmentId = productionEnv.node.id;

  const service = await railwayRequest<{ serviceCreate: RailwayService }>(token, CREATE_SERVICE_MUTATION, {
    input: { projectId, name: tool.id, source: { image: tool.image } },
  });
  const serviceId = service.serviceCreate.id;

  await railwayRequest(token, UPDATE_SERVICE_INSTANCE_MUTATION, {
    serviceId, environmentId, input: { startCommand: buildRailwayStartCommand(tool.startup) },
  });

  const envVars = tool.buildEnv({ ...env, serviceUrl: "" });
  const variables: Record<string, string> = {};
  for (const { key, value } of envVars) variables[key] = value;
  await railwayRequest(token, UPSERT_VARIABLES_MUTATION, { input: { projectId, environmentId, serviceId, variables } });

  await railwayRequest(token, TRIGGER_DEPLOY_MUTATION, { input: { environmentId, projectId, serviceId } });

  let generatedDomain: string | null = null;
  try {
    const domainResult = await railwayRequest<{ serviceDomainCreate: { domain: string } }>(token, CREATE_SERVICE_DOMAIN_MUTATION, {
      input: { environmentId, serviceId, targetPort: tool.port || RAILWAY_PORT_FALLBACK },
    });
    generatedDomain = domainResult?.serviceDomainCreate?.domain ?? null;
  } catch {
    // Best-effort — refresh will retry via GET_SERVICE_URL_QUERY.
  }

  const publicUrl = generatedDomain ? `https://${generatedDomain}` : null;
  // Encode projectId/environmentId into the composite id so update/refresh/delete
  // don't need a separate DB lookup to find them.
  const compositeServiceId = `${serviceId}:${projectId}:${environmentId}`;

  return { externalServiceId: compositeServiceId, externalDeployId: null, publicUrl, status: "provisioning", gatewayToken: env.gatewayToken };
}

async function updateRailwayDeployment(token: string, compositeServiceId: string, tool: CloudToolManifest, env: CloudToolEnvInput): Promise<UpdateResult> {
  const [serviceId, projectId, environmentId] = compositeServiceId.split(":");
  if (projectId && environmentId) {
    const envVars = tool.buildEnv(env);
    const variables: Record<string, string> = {};
    for (const { key, value } of envVars) variables[key] = value;
    await railwayRequest(token, UPSERT_VARIABLES_MUTATION, { input: { projectId, environmentId, serviceId, variables } });
  }
  await railwayRequest(token, TRIGGER_DEPLOY_MUTATION, { input: { environmentId, projectId, serviceId } });
  return { externalDeployId: null };
}

async function refreshRailwayDeployment(token: string, compositeServiceId: string, externalDeployId: string | null): Promise<RefreshResult> {
  const [serviceId, , environmentId] = compositeServiceId.split(":");
  try {
    let dep: RailwayDeployment;
    if (externalDeployId) {
      const data = await railwayRequest<{ deployment: RailwayDeployment }>(token, GET_DEPLOYMENT_QUERY, { id: externalDeployId });
      dep = data.deployment;
    } else {
      const data = await railwayRequest<{ deployments: { edges: Array<{ node: RailwayDeployment }> } }>(
        token, LIST_SERVICE_DEPLOYMENTS_QUERY, { serviceId, environmentId },
      );
      const node = data.deployments.edges[0]?.node;
      if (!node) return { externalDeployId: null, error: null, missing: false, publicUrl: null, status: "provisioning" };
      dep = node;
    }

    const mapped = mapRailwayDeploymentStatus(dep.status);
    let publicUrl: string | null = dep.url || null;
    if (!publicUrl && mapped.status === "healthy") {
      try {
        const svc = await railwayRequest<{
          service: { serviceInstances: { edges: Array<{ node: { environmentId?: string; domains?: { serviceDomains?: Array<{ domain: string }> } } }> } };
        }>(token, GET_SERVICE_URL_QUERY, { id: serviceId });
        const edges = svc?.service?.serviceInstances?.edges || [];
        const matching = environmentId ? edges.find((e) => e?.node?.environmentId === environmentId) : edges[0];
        const domain = matching?.node?.domains?.serviceDomains?.[0]?.domain;
        if (domain) publicUrl = `https://${domain}`;
      } catch {
        // Best-effort.
      }
    }

    return { externalDeployId: dep.id, error: mapped.error, missing: false, publicUrl, status: mapped.status };
  } catch (error) {
    if (error instanceof CloudProviderError && error.type === CloudProviderErrorType.RESOURCE_NOT_FOUND) {
      return { externalDeployId, error: null, missing: true, publicUrl: null, status: "failed" };
    }
    throw error;
  }
}

async function deleteRailwayService(token: string, compositeServiceId: string): Promise<"deleted" | "missing"> {
  const [serviceId, projectId] = compositeServiceId.split(":");
  if (projectId) {
    try {
      await railwayRequest(token, DELETE_PROJECT_MUTATION, { id: projectId });
      return "deleted";
    } catch (error) {
      if (error instanceof CloudProviderError && error.type === CloudProviderErrorType.RESOURCE_NOT_FOUND) return "missing";
    }
  }
  try {
    await railwayRequest(token, DELETE_SERVICE_MUTATION, { id: serviceId });
    return "deleted";
  } catch (error) {
    if (error instanceof CloudProviderError && error.type === CloudProviderErrorType.RESOURCE_NOT_FOUND) return "missing";
    throw error;
  }
}

export const railwayDriver: CloudProviderDriver = {
  async validateToken(token: string): Promise<AccountMetadata> {
    const data = await railwayRequest<{ me: RailwayUser }>(token, VALIDATE_TOKEN_QUERY);
    if (!data.me?.id) throw new CloudProviderError(CloudProviderErrorType.AUTHENTICATION, "railway", "Token Railway válido mas sem acesso a dados do usuário.");
    return {
      externalUserEmail: data.me.email ?? null,
      externalUserId: data.me.id,
      externalOrgId: data.me.id,
      externalOrgName: data.me.name ?? null,
    };
  },

  async createDeployment(token, resourceName, tool, env) {
    try {
      return await createRailwayDeployment(token, resourceName, tool, env);
    } catch (error) {
      throw toRailwayError(error);
    }
  },

  async updateDeployment(token, externalServiceId, tool, env) {
    try {
      return await updateRailwayDeployment(token, externalServiceId, tool, env);
    } catch (error) {
      throw toRailwayError(error);
    }
  },

  async refresh(token, externalServiceId, externalDeployId) {
    try {
      return await refreshRailwayDeployment(token, externalServiceId, externalDeployId);
    } catch (error) {
      throw toRailwayError(error);
    }
  },

  async deleteService(token, externalServiceId) {
    try {
      return await deleteRailwayService(token, externalServiceId);
    } catch (error) {
      throw toRailwayError(error);
    }
  },

  isFreeTierError: isRailwayFreeTierError,
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/cloud/providers/railway.ts
git commit -m "feat: add generalized Railway cloud provider driver"
```

---

## Task 6: Provider registry + gateway config resolver

**Files:**
- Create: `src/server/cloud/providers/registry.ts`
- Create: `src/server/cloud/gatewayConfig.ts`

**Interfaces:**
- Consumes: `renderDriver` (Task 4), `railwayDriver` (Task 5), `CloudProviderDriver`/`CloudProvider` (Task 3), `getCloudUrl` and `getApiKeys` (existing, `@/lib/db`)
- Produces (used by Tasks 7-8):
  - `CLOUD_PROVIDERS: Record<CloudProvider, CloudProviderDriver>`
  - `getCloudProviderDriver(provider: string): CloudProviderDriver | null`
  - `resolveGatewayConfig(): Promise<{ gatewayApiUrl: string; apiKeys: Array<{ id: string; key: string; name?: string }> }>`

- [ ] **Step 1: Write `providers/registry.ts`**

```ts
import type { CloudProvider, CloudProviderDriver } from "./driver";
import { renderDriver } from "./render";
import { railwayDriver } from "./railway";

export const CLOUD_PROVIDERS: Record<CloudProvider, CloudProviderDriver> = {
  render: renderDriver,
  railway: railwayDriver,
};

export function getCloudProviderDriver(provider: string): CloudProviderDriver | null {
  if (provider === "render" || provider === "railway") return CLOUD_PROVIDERS[provider];
  return null;
}
```

- [ ] **Step 2: Write `gatewayConfig.ts`**

This resolves the base URL a cloud-deployed tool should call back into — reusing the same `getCloudUrl()` (tunnel/public URL) and `getApiKeys()` the local CLI-tools pages already use (see `BaseUrlSelect`/`ApiKeySelect` in `src/app/(dashboard)/dashboard/cli-tools/components/`), so the deploy form can default to a working value instead of asking the user to hand-type it.

```ts
import { getCloudUrl, getApiKeys } from "@/lib/db";

export type GatewayApiKey = { id: string; key: string; name?: string };

export async function resolveGatewayConfig(): Promise<{ gatewayApiUrl: string; apiKeys: GatewayApiKey[] }> {
  const [cloudUrl, apiKeys] = await Promise.all([getCloudUrl(), getApiKeys()]);
  const base = (cloudUrl || "").replace(/\/+$/, "");
  const gatewayApiUrl = base ? (/\/v1$/.test(base) ? base : `${base}/v1`) : "";
  return {
    gatewayApiUrl,
    apiKeys: apiKeys.map((k) => ({ id: k.id, key: k.key, name: k.name })),
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: no new type errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/cloud/providers/registry.ts src/server/cloud/gatewayConfig.ts
git commit -m "feat: add cloud provider registry and gateway config resolver"
```

---

## Task 7: Connections API routes

**Files:**
- Create: `src/app/api/cloud/connections/route.ts` (GET list)
- Create: `src/app/api/cloud/connections/[provider]/route.ts` (POST connect, DELETE)
- Test: `tests/unit/cloudConnectionsRoute.test.ts`

**Interfaces:**
- Consumes: `getCloudConnections`, `createCloudConnection`, `deleteCloudConnection`, `getCloudConnectionById` (Task 1); `getCloudProviderDriver` (Task 6); `CloudProviderError`, `formatCloudProviderError`, `isCloudProviderError` (Task 3)
- Produces: `GET /api/cloud/connections`, `POST /api/cloud/connections/[provider]`, `DELETE /api/cloud/connections/[provider]`

Response shape never includes the raw `token` field — only `id`, `provider`, `label`, `externalUserEmail`, `externalOrgName`, `createdAt`, `updatedAt`.

- [ ] **Step 1: Write `connections/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getCloudConnections } from "@/models";

function serializeConnection(c: Awaited<ReturnType<typeof getCloudConnections>>[number]) {
  return {
    id: c.id,
    provider: c.provider,
    label: c.label,
    externalUserEmail: c.externalUserEmail,
    externalOrgName: c.externalOrgName,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function GET() {
  const connections = await getCloudConnections();
  return NextResponse.json({ connections: connections.map(serializeConnection) });
}
```

- [ ] **Step 2: Write `connections/[provider]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createCloudConnection, deleteCloudConnection, getCloudConnectionByProvider } from "@/models";
import { getCloudProviderDriver } from "@/server/cloud/providers/registry";
import { isCloudProviderError, formatCloudProviderError } from "@/server/cloud/providers/driver";

type Params = { params: Promise<{ provider: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { provider } = await params;
  const driver = getCloudProviderDriver(provider);
  if (!driver) {
    return NextResponse.json({ error: "Provider não suportado" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Token é obrigatório" }, { status: 400 });
  }

  try {
    const metadata = await driver.validateToken(token);
    const connection = await createCloudConnection({
      provider,
      label: typeof body?.label === "string" ? body.label : undefined,
      token,
      externalUserEmail: metadata.externalUserEmail,
      externalOrgId: metadata.externalOrgId,
      externalOrgName: metadata.externalOrgName,
    });
    return NextResponse.json({
      connection: {
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        externalUserEmail: connection.externalUserEmail,
        externalOrgName: connection.externalOrgName,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      },
    }, { status: 201 });
  } catch (error) {
    if (isCloudProviderError(error)) {
      return NextResponse.json({ error: formatCloudProviderError(error) }, { status: 401 });
    }
    console.error("[cloud/connections] failed to validate token", error);
    return NextResponse.json({ error: "Falha ao validar token" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { provider } = await params;
  const existing = await getCloudConnectionByProvider(provider);
  if (!existing) {
    return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
  }
  await deleteCloudConnection(existing.id);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/models", () => ({
  createCloudConnection: vi.fn(),
  deleteCloudConnection: vi.fn(),
  getCloudConnectionByProvider: vi.fn(),
}));
vi.mock("@/server/cloud/providers/registry", () => ({
  getCloudProviderDriver: vi.fn(),
}));

import { POST, DELETE } from "@/app/api/cloud/connections/[provider]/route";
import { createCloudConnection, deleteCloudConnection, getCloudConnectionByProvider } from "@/models";
import { getCloudProviderDriver } from "@/server/cloud/providers/registry";

function req(body: unknown): Request {
  return new Request("http://localhost/api/cloud/connections/render", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/cloud/connections/[provider]", () => {
  it("rejects an unsupported provider", async () => {
    vi.mocked(getCloudProviderDriver).mockReturnValue(null);
    const res = await POST(req({ token: "x" }) as never, { params: Promise.resolve({ provider: "unknown" }) });
    expect(res.status).toBe(400);
  });

  it("rejects a missing token", async () => {
    vi.mocked(getCloudProviderDriver).mockReturnValue({ validateToken: vi.fn() } as never);
    const res = await POST(req({}) as never, { params: Promise.resolve({ provider: "render" }) });
    expect(res.status).toBe(400);
  });

  it("creates a connection when the token validates", async () => {
    vi.mocked(getCloudProviderDriver).mockReturnValue({
      validateToken: vi.fn().mockResolvedValue({ externalUserEmail: "a@b.com", externalUserId: "1", externalOrgId: "1", externalOrgName: "Org" }),
    } as never);
    vi.mocked(createCloudConnection).mockResolvedValue({
      id: "conn1", provider: "render", label: null, token: "x",
      externalUserEmail: "a@b.com", externalOrgId: "1", externalOrgName: "Org",
      createdAt: "now", updatedAt: "now",
    } as never);

    const res = await POST(req({ token: "sometoken" }) as never, { params: Promise.resolve({ provider: "render" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.connection.id).toBe("conn1");
  });
});

describe("DELETE /api/cloud/connections/[provider]", () => {
  it("returns 404 when there is no connection for the provider", async () => {
    vi.mocked(getCloudConnectionByProvider).mockResolvedValue(null);
    const res = await DELETE(new Request("http://localhost") as never, { params: Promise.resolve({ provider: "render" }) });
    expect(res.status).toBe(404);
  });

  it("deletes an existing connection", async () => {
    vi.mocked(getCloudConnectionByProvider).mockResolvedValue({ id: "conn1" } as never);
    const res = await DELETE(new Request("http://localhost") as never, { params: Promise.resolve({ provider: "render" }) });
    expect(res.status).toBe(200);
    expect(deleteCloudConnection).toHaveBeenCalledWith("conn1");
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `npx vitest run tests/unit/cloudConnectionsRoute.test.ts`
Expected: FAIL first (missing route file — write it if Step 2 was skipped), then PASS (5 tests) after Step 2's file exists.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cloud/connections tests/unit/cloudConnectionsRoute.test.ts
git commit -m "feat: add cloud connections API routes"
```

---

## Task 8: Deployments API routes

**Files:**
- Create: `src/app/api/cloud/deployments/route.ts` (GET list, POST create)
- Create: `src/app/api/cloud/deployments/[id]/route.ts` (DELETE)
- Create: `src/app/api/cloud/deployments/[id]/refresh/route.ts` (POST refresh)
- Test: `tests/unit/cloudDeploymentsRoute.test.ts`

**Interfaces:**
- Consumes: `getCloudDeployments`, `createCloudDeployment`, `updateCloudDeployment`, `deleteCloudDeployment`, `getCloudDeploymentById` (Task 1); `getCloudConnectionByProvider`, `getCloudConnectionById` (Task 1); `getCloudTool` (Task 2); `getCloudProviderDriver` (Task 6); `resolveGatewayConfig` (Task 6); `CloudProviderError`, `formatCloudProviderError`, `isCloudProviderError`, `generateResourceName` (Task 3)
- Produces: `GET /api/cloud/deployments`, `POST /api/cloud/deployments`, `DELETE /api/cloud/deployments/[id]`, `POST /api/cloud/deployments/[id]/refresh`

Deployment serialization never includes `gatewayToken`.

- [ ] **Step 1: Write `deployments/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createCloudDeployment, getCloudConnectionByProvider, getCloudDeployments } from "@/models";
import { getCloudTool } from "@/server/cloud/tools/registry";
import { getCloudProviderDriver } from "@/server/cloud/providers/registry";
import { generateResourceName, isCloudProviderError, formatCloudProviderError } from "@/server/cloud/providers/driver";
import { resolveGatewayConfig } from "@/server/cloud/gatewayConfig";
import { randomBytes } from "node:crypto";

function serializeDeployment(d: Awaited<ReturnType<typeof getCloudDeployments>>[number]) {
  const { gatewayToken: _gatewayToken, ...rest } = d;
  return rest;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const toolId = searchParams.get("toolId") ?? undefined;
  const provider = searchParams.get("provider") ?? undefined;
  const deployments = await getCloudDeployments({ toolId, provider });
  return NextResponse.json({ deployments: deployments.map(serializeDeployment) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const provider = typeof body?.provider === "string" ? body.provider : "";
  const toolId = typeof body?.toolId === "string" ? body.toolId : "";
  const model = typeof body?.model === "string" ? body.model : "";
  const modelProvider = typeof body?.modelProvider === "string" ? body.modelProvider : "";
  const gatewayApiKey = typeof body?.gatewayApiKey === "string" ? body.gatewayApiKey : "";

  const driver = getCloudProviderDriver(provider);
  const tool = getCloudTool(toolId);
  if (!driver) return NextResponse.json({ error: "Provider não suportado" }, { status: 400 });
  if (!tool) return NextResponse.json({ error: "Ferramenta não disponível para deploy em nuvem" }, { status: 400 });
  if (!model || !modelProvider) return NextResponse.json({ error: "model e modelProvider são obrigatórios" }, { status: 400 });

  const connection = await getCloudConnectionByProvider(provider);
  if (!connection) return NextResponse.json({ error: "Conecte sua conta antes de fazer deploy" }, { status: 400 });

  const { gatewayApiUrl } = await resolveGatewayConfig();
  if (!gatewayApiUrl) return NextResponse.json({ error: "Configure a URL pública do squid (Cloud/Tunnel) antes de fazer deploy" }, { status: 400 });
  if (!gatewayApiKey) return NextResponse.json({ error: "gatewayApiKey é obrigatório" }, { status: 400 });

  const resourceName = generateResourceName(toolId);
  const gatewayToken = randomBytes(32).toString("hex");

  try {
    const result = await driver.createDeployment(connection.token, resourceName, tool, {
      gatewayToken, gatewayApiUrl, gatewayApiKey, model, provider: modelProvider, serviceUrl: "",
    });
    const deployment = await createCloudDeployment({
      connectionId: connection.id,
      provider,
      toolId,
      status: result.status,
      publicUrl: result.publicUrl,
      image: tool.image,
      region: typeof body?.region === "string" ? body.region : "",
      instanceType: "free",
      port: tool.port,
      externalServiceId: result.externalServiceId,
      externalDeployId: result.externalDeployId,
      gatewayToken: result.gatewayToken,
      config: { model, modelProvider },
    });
    return NextResponse.json({ deployment: serializeDeployment(deployment) }, { status: 201 });
  } catch (error) {
    if (isCloudProviderError(error)) {
      return NextResponse.json({ error: formatCloudProviderError(error) }, { status: 502 });
    }
    console.error("[cloud/deployments] failed to create deployment", error);
    return NextResponse.json({ error: "Falha ao criar deployment" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write `deployments/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { deleteCloudDeployment, getCloudDeploymentById, getCloudConnectionById } from "@/models";
import { getCloudProviderDriver } from "@/server/cloud/providers/registry";
import { isCloudProviderError, formatCloudProviderError } from "@/server/cloud/providers/driver";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deployment = await getCloudDeploymentById(id);
  if (!deployment) return NextResponse.json({ error: "Deployment não encontrado" }, { status: 404 });

  const connection = await getCloudConnectionById(deployment.connectionId);
  const driver = getCloudProviderDriver(deployment.provider);

  if (connection && driver) {
    try {
      await driver.deleteService(connection.token, deployment.externalServiceId);
    } catch (error) {
      if (isCloudProviderError(error)) {
        return NextResponse.json({ error: formatCloudProviderError(error) }, { status: 502 });
      }
      console.error("[cloud/deployments] failed to delete external service", error);
    }
  }

  await deleteCloudDeployment(id);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Write `deployments/[id]/refresh/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getCloudDeploymentById, getCloudConnectionById, updateCloudDeployment } from "@/models";
import { getCloudProviderDriver } from "@/server/cloud/providers/registry";
import { isCloudProviderError, formatCloudProviderError } from "@/server/cloud/providers/driver";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deployment = await getCloudDeploymentById(id);
  if (!deployment) return NextResponse.json({ error: "Deployment não encontrado" }, { status: 404 });

  const connection = await getCloudConnectionById(deployment.connectionId);
  const driver = getCloudProviderDriver(deployment.provider);
  if (!connection || !driver) return NextResponse.json({ error: "Provider não suportado" }, { status: 400 });

  try {
    const refreshed = await driver.refresh(connection.token, deployment.externalServiceId, deployment.externalDeployId);
    if (refreshed.missing) {
      await updateCloudDeployment(id, { status: "failed", error: "Serviço não encontrado no provider — pode ter sido apagado externamente." });
    } else {
      await updateCloudDeployment(id, {
        status: refreshed.status,
        publicUrl: refreshed.publicUrl ?? deployment.publicUrl,
        error: refreshed.error,
        externalDeployId: refreshed.externalDeployId ?? deployment.externalDeployId,
      });
    }
    const updated = await getCloudDeploymentById(id);
    const { gatewayToken: _gatewayToken, ...rest } = updated!;
    return NextResponse.json({ deployment: rest });
  } catch (error) {
    if (isCloudProviderError(error)) {
      return NextResponse.json({ error: formatCloudProviderError(error) }, { status: 502 });
    }
    console.error("[cloud/deployments] failed to refresh deployment", error);
    return NextResponse.json({ error: "Falha ao atualizar status" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/models", () => ({
  createCloudDeployment: vi.fn(),
  getCloudConnectionByProvider: vi.fn(),
  getCloudDeployments: vi.fn(),
}));
vi.mock("@/server/cloud/tools/registry", () => ({ getCloudTool: vi.fn() }));
vi.mock("@/server/cloud/providers/registry", () => ({ getCloudProviderDriver: vi.fn() }));
vi.mock("@/server/cloud/gatewayConfig", () => ({ resolveGatewayConfig: vi.fn() }));

import { POST } from "@/app/api/cloud/deployments/route";
import { createCloudDeployment, getCloudConnectionByProvider } from "@/models";
import { getCloudTool } from "@/server/cloud/tools/registry";
import { getCloudProviderDriver } from "@/server/cloud/providers/registry";
import { resolveGatewayConfig } from "@/server/cloud/gatewayConfig";

function req(body: unknown): Request {
  return new Request("http://localhost/api/cloud/deployments", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/cloud/deployments", () => {
  it("rejects a toolId with no manifest", async () => {
    vi.mocked(getCloudProviderDriver).mockReturnValue({} as never);
    vi.mocked(getCloudTool).mockReturnValue(null);
    const res = await POST(req({ provider: "render", toolId: "codex", model: "gpt-4o", modelProvider: "openai", gatewayApiKey: "k" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects when there is no connection for the provider", async () => {
    vi.mocked(getCloudProviderDriver).mockReturnValue({} as never);
    vi.mocked(getCloudTool).mockReturnValue({ id: "openclaw", image: "img", port: 1 } as never);
    vi.mocked(getCloudConnectionByProvider).mockResolvedValue(null);
    const res = await POST(req({ provider: "render", toolId: "openclaw", model: "gpt-4o", modelProvider: "openai", gatewayApiKey: "k" }) as never);
    expect(res.status).toBe(400);
  });

  it("creates a deployment end to end", async () => {
    vi.mocked(getCloudTool).mockReturnValue({ id: "openclaw", image: "img", port: 10000 } as never);
    vi.mocked(getCloudConnectionByProvider).mockResolvedValue({ id: "conn1", token: "tok" } as never);
    vi.mocked(resolveGatewayConfig).mockResolvedValue({ gatewayApiUrl: "https://squid.example.com/v1", apiKeys: [] });
    vi.mocked(getCloudProviderDriver).mockReturnValue({
      createDeployment: vi.fn().mockResolvedValue({
        externalServiceId: "svc1", externalDeployId: "dep1", publicUrl: "https://svc1.onrender.com", status: "provisioning", gatewayToken: "gw",
      }),
    } as never);
    vi.mocked(createCloudDeployment).mockResolvedValue({
      id: "d1", connectionId: "conn1", provider: "render", toolId: "openclaw", status: "provisioning",
      publicUrl: "https://svc1.onrender.com", createdAt: "now", updatedAt: "now",
      image: "img", region: "", instanceType: "free", port: 10000,
      externalServiceId: "svc1", externalDeployId: "dep1", gatewayToken: "gw", config: {}, error: null,
    } as never);

    const res = await POST(req({ provider: "render", toolId: "openclaw", model: "gpt-4o", modelProvider: "openai", gatewayApiKey: "sk-x" }) as never);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.deployment.id).toBe("d1");
    expect(json.deployment.gatewayToken).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run test to verify it fails, then passes**

Run: `npx vitest run tests/unit/cloudDeploymentsRoute.test.ts`
Expected: FAIL first (route not implemented yet if Steps 1-3 not done), PASS (3 tests) once implemented.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cloud/deployments tests/unit/cloudDeploymentsRoute.test.ts
git commit -m "feat: add cloud deployments API routes (create, list, refresh, delete)"
```

---

## Task 9: Sidebar navigation entry

**Files:**
- Modify: `src/shared/components/Sidebar.tsx:50-58`

**Interfaces:** none — pure UI wiring.

- [ ] **Step 1: Add the nav item**

In `src/shared/components/Sidebar.tsx`, add `CloudUpload` to the existing `lucide-react` import at the top of the file (alongside `Terminal`, `Server`, etc.), then add the entry right after `cli-tools` in `navItems`:

```ts
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: <Terminal /> },
  { href: "/dashboard/cloud", label: "Cloud Deploy", icon: <CloudUpload /> },
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/components/Sidebar.tsx
git commit -m "feat: add Cloud Deploy sidebar entry"
```

---

## Task 10: Cloud page UI

**Files:**
- Create: `src/app/(dashboard)/dashboard/cloud/page.tsx`
- Create: `src/app/(dashboard)/dashboard/cloud/CloudPageClient.tsx`
- Create: `src/app/(dashboard)/dashboard/cloud/toolCatalog.ts`
- Create: `src/app/(dashboard)/dashboard/cloud/components/ProviderConnectCard.tsx`
- Create: `src/app/(dashboard)/dashboard/cloud/components/DeployForm.tsx`
- Create: `src/app/(dashboard)/dashboard/cloud/components/DeploymentCard.tsx`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/cloud/connections`, `GET/POST/DELETE /api/cloud/deployments`, `POST /api/cloud/deployments/[id]/refresh` (Tasks 7-8); reuses `ApiKeySelect` from `src/app/(dashboard)/dashboard/cli-tools/components/ApiKeySelect.tsx` and shadcn primitives (`Dialog`, `Select`, `Input`, `Button`, `Badge`) already used elsewhere in the dashboard.
- Produces: `/dashboard/cloud` route.

- [ ] **Step 1: Write `page.tsx`** (server component, just renders the client page — follow the pattern in `src/app/(dashboard)/dashboard/cli-tools/page.tsx`)

```tsx
import CloudPageClient from "./CloudPageClient";

export default function CloudPage() {
  return <CloudPageClient />;
}
```

- [ ] **Step 2: Write `ProviderConnectCard.tsx`**

```tsx
"use client";

import { useState } from "react";
import Button from "@/shared/components/Button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface Connection {
  id: string;
  provider: string;
  externalUserEmail: string | null;
  externalOrgName: string | null;
}

interface ProviderConnectCardProps {
  provider: "render" | "railway";
  label: string;
  hint: string;
  connection: Connection | null;
  onConnect: (provider: string, token: string) => Promise<{ error?: string }>;
  onDisconnect: (provider: string) => Promise<void>;
}

export default function ProviderConnectCard({ provider, label, hint, connection, onConnect, onDisconnect }: ProviderConnectCardProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConnect = async () => {
    setIsSubmitting(true);
    setError(null);
    const result = await onConnect(provider, token.trim());
    setIsSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setToken("");
    setOpen(false);
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-surface/40 px-4 py-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{label}</span>
          <Badge variant={connection ? "default" : "secondary"}>
            {connection ? "Conectado" : "Desconectado"}
          </Badge>
        </div>
        <p className="text-xs text-text-muted">
          {connection?.externalUserEmail || connection?.externalOrgName || hint}
        </p>
      </div>
      {connection ? (
        <Button variant="outline" size="sm" onClick={() => onDisconnect(provider)}>Desconectar</Button>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">Conectar</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Conectar {label}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2 py-2">
              <Input
                type="password"
                placeholder="API token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={handleConnect} disabled={!token.trim() || isSubmitting}>
                {isSubmitting ? "Validando..." : "Conectar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `DeployForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import Button from "@/shared/components/Button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import ApiKeySelect from "../../cli-tools/components/ApiKeySelect";

interface ApiKey {
  id: string;
  key: string;
  name?: string;
}

interface DeployFormProps {
  toolName: string;
  availableProviders: Array<{ id: "render" | "railway"; label: string; connected: boolean }>;
  apiKeys: ApiKey[];
  cloudEnabled: boolean;
  onDeploy: (input: { provider: string; model: string; modelProvider: string; gatewayApiKey: string }) => Promise<void>;
}

export default function DeployForm({ toolName, availableProviders, apiKeys, cloudEnabled, onDeploy }: DeployFormProps) {
  const connectedProviders = availableProviders.filter((p) => p.connected);
  const [provider, setProvider] = useState(connectedProviders[0]?.id ?? "");
  const [model, setModel] = useState("");
  const [modelProvider, setModelProvider] = useState("");
  const [apiKey, setApiKey] = useState(apiKeys[0]?.key ?? "");
  const [isDeploying, setIsDeploying] = useState(false);

  const canDeploy = provider && model.trim() && modelProvider.trim() && apiKey && !isDeploying;

  const handleDeploy = async () => {
    if (!canDeploy) return;
    setIsDeploying(true);
    try {
      await onDeploy({ provider, model: model.trim(), modelProvider: modelProvider.trim(), gatewayApiKey: apiKey });
    } finally {
      setIsDeploying(false);
    }
  };

  if (connectedProviders.length === 0) {
    return <p className="text-sm text-text-muted">Conecte um provedor cloud acima para fazer deploy do {toolName}.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Select value={provider} onValueChange={(v) => v && setProvider(v)}>
        <SelectTrigger><SelectValue placeholder="Onde hospedar" /></SelectTrigger>
        <SelectContent>
          {connectedProviders.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <input
        className="rounded-md border border-border bg-surface/40 px-3 py-2 text-sm"
        placeholder="Provider do agente (ex: openai)"
        value={modelProvider}
        onChange={(e) => setModelProvider(e.target.value)}
      />
      <input
        className="rounded-md border border-border bg-surface/40 px-3 py-2 text-sm"
        placeholder="Modelo (ex: gpt-4o)"
        value={model}
        onChange={(e) => setModel(e.target.value)}
      />
      <ApiKeySelect value={apiKey} onChange={setApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
      <Button onClick={handleDeploy} disabled={!canDeploy}>
        {isDeploying ? "Fazendo deploy..." : `Deploy ${toolName}`}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Write `DeploymentCard.tsx`**

```tsx
"use client";

import Button from "@/shared/components/Button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Trash2, ExternalLink } from "lucide-react";

interface Deployment {
  id: string;
  provider: string;
  toolId: string;
  status: "provisioning" | "healthy" | "failed" | "deleting";
  publicUrl: string | null;
  error: string | null;
}

interface DeploymentCardProps {
  deployment: Deployment;
  toolName: string;
  onRefresh: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const STATUS_LABEL: Record<Deployment["status"], string> = {
  provisioning: "Provisionando",
  healthy: "Ativo",
  failed: "Falhou",
  deleting: "Removendo",
};

const STATUS_VARIANT: Record<Deployment["status"], "default" | "secondary" | "destructive"> = {
  provisioning: "secondary",
  healthy: "default",
  failed: "destructive",
  deleting: "secondary",
};

export default function DeploymentCard({ deployment, toolName, onRefresh, onDelete }: DeploymentCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface/40 p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{toolName} · {deployment.provider}</span>
        <Badge variant={STATUS_VARIANT[deployment.status]}>{STATUS_LABEL[deployment.status]}</Badge>
      </div>
      {deployment.publicUrl && (
        <a href={deployment.publicUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-text-muted hover:text-text">
          {deployment.publicUrl}
          <ExternalLink className="size-3" />
        </a>
      )}
      {deployment.error && <p className="text-xs text-red-500">{deployment.error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onRefresh(deployment.id)}>
          <RefreshCw className="size-3.5" /> Atualizar
        </Button>
        <Button variant="outline" size="sm" onClick={() => onDelete(deployment.id)}>
          <Trash2 className="size-3.5" /> Apagar
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write `toolCatalog.ts`**

Client-safe static catalog — the client page renders this instead of importing `src/server/cloud/tools/registry.ts` directly, keeping server-only code (env/config builders) out of the client bundle.

```ts
export const CLOUD_TOOL_CATALOG: Array<{ id: string; name: string; icon: string }> = [
  { id: "openclaw", name: "OpenClaw", icon: "/providers/openclaw.png" },
];
```

- [ ] **Step 6: Write `CloudPageClient.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import ProviderConnectCard from "./components/ProviderConnectCard";
import DeployForm from "./components/DeployForm";
import DeploymentCard from "./components/DeploymentCard";
import { CLOUD_TOOL_CATALOG } from "./toolCatalog";

interface Connection {
  id: string;
  provider: string;
  externalUserEmail: string | null;
  externalOrgName: string | null;
}

interface Deployment {
  id: string;
  provider: string;
  toolId: string;
  status: "provisioning" | "healthy" | "failed" | "deleting";
  publicUrl: string | null;
  error: string | null;
}

interface ApiKey {
  id: string;
  key: string;
  name?: string;
}

const PROVIDER_META = [
  { id: "render" as const, label: "Render", hint: "Free tier com 750h/mês" },
  { id: "railway" as const, label: "Railway", hint: "Free tier com créditos mensais" },
];

export default function CloudPageClient() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [selectedToolId, setSelectedToolId] = useState(CLOUD_TOOL_CATALOG[0]?.id ?? "");
  const [isLoading, setIsLoading] = useState(true);

  const loadAll = useCallback(async () => {
    const [connectionsRes, deploymentsRes, settingsRes, keysRes] = await Promise.all([
      fetch("/api/cloud/connections").then((r) => r.json()),
      fetch("/api/cloud/deployments").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()).catch(() => null),
      fetch("/api/keys").then((r) => r.json()).catch(() => null),
    ]);
    setConnections(connectionsRes.connections ?? []);
    setDeployments(deploymentsRes.deployments ?? []);
    setCloudEnabled(Boolean(settingsRes?.cloudEnabled));
    setApiKeys(keysRes?.keys ?? []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleConnect = async (provider: string, token: string) => {
    const res = await fetch(`/api/cloud/connections/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error ?? "Falha ao conectar" };
    await loadAll();
    return {};
  };

  const handleDisconnect = async (provider: string) => {
    await fetch(`/api/cloud/connections/${provider}`, { method: "DELETE" });
    await loadAll();
  };

  const handleDeploy = async (toolId: string, input: { provider: string; model: string; modelProvider: string; gatewayApiKey: string }) => {
    await fetch("/api/cloud/deployments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolId, ...input }),
    });
    await loadAll();
  };

  const handleRefresh = async (id: string) => {
    await fetch(`/api/cloud/deployments/${id}/refresh`, { method: "POST" });
    await loadAll();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/cloud/deployments/${id}`, { method: "DELETE" });
    await loadAll();
  };

  const selectedTool = CLOUD_TOOL_CATALOG.find((t) => t.id === selectedToolId) ?? CLOUD_TOOL_CATALOG[0];

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-semibold">Cloud Deploy</h1>
        <p className="text-sm text-text-muted">Provisione CLIs na nuvem em vez de rodá-las apenas na máquina local.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {PROVIDER_META.map((p) => (
          <ProviderConnectCard
            key={p.id}
            provider={p.id}
            label={p.label}
            hint={p.hint}
            connection={connections.find((c) => c.provider === p.id) ?? null}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        ))}
      </div>

      {!isLoading && CLOUD_TOOL_CATALOG.length === 0 && (
        <p className="text-sm text-text-muted">Nenhuma CLI com imagem headless disponível para deploy em nuvem no momento.</p>
      )}

      {selectedTool && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">{selectedTool.name}</h2>
            <DeployForm
              toolName={selectedTool.name}
              availableProviders={PROVIDER_META.map((p) => ({ ...p, connected: connections.some((c) => c.provider === p.id) }))}
              apiKeys={apiKeys}
              cloudEnabled={cloudEnabled}
              onDeploy={(input) => handleDeploy(selectedTool.id, input)}
            />
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Seus ambientes</h2>
            {deployments.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhum ambiente criado. Conecte um provedor, escolha o modelo e clique em Deploy.</p>
            ) : (
              deployments.map((d) => (
                <DeploymentCard
                  key={d.id}
                  deployment={d}
                  toolName={CLOUD_TOOL_CATALOG.find((t) => t.id === d.toolId)?.name ?? d.toolId}
                  onRefresh={handleRefresh}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Typecheck and manual QA**

Run: `npm run check`
Expected: no new type errors.

Run the dev server, navigate to `/dashboard/cloud`, verify:
- Page renders with Render/Railway connect cards.
- Connecting with an invalid token shows the pt-BR error inline.
- With a real Render or Railway free-tier token, deploying OpenClaw creates a service and the environments list shows it as "Provisionando" then "Ativo" after a refresh.
- Responsive: page collapses to a single column at mobile widths (320-768px), no horizontal overflow.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(dashboard)/dashboard/cloud"
git commit -m "feat: add Cloud Deploy dashboard page"
```

---

## Self-Review Notes

- **Spec coverage:** DB model (Task 1), tool manifest registry (Task 2), provider driver + errors (Task 3), Render/Railway drivers (Tasks 4-5), provider registry + gateway config (Task 6), connections routes (Task 7), deployments routes (Task 8), nav entry (Task 9), UI (Task 10) — every section of the spec has a task.
- **Type consistency:** `CloudToolManifest`/`CloudToolEnvInput`/`CloudToolInfo` (Task 2) are the single source of truth consumed identically by `driver.ts` (Task 3), `render.ts` (Task 4), `railway.ts` (Task 5), and both route files (Tasks 7-8). `DeployResult.gatewayToken`, `CloudDeployment.gatewayToken`, and the route's `_gatewayToken` destructure-and-drop all agree on the field name.
- **Known gap flagged for manual QA (Task 10, Step 7):** the exact health/ready paths and port for `ghcr.io/openclaw/openclaw` are carried over from modelhub's values (port 10000, `/healthz`, `/readyz`) — confirm against a real deploy before shipping, per the spec's "Riscos" section.
