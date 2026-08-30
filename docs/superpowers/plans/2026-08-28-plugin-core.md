# Plugin Core (Cordis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a Cordis-based plugin `Context` as the foundation for squid's future dsh-style playground, and migrate the existing executor/provider registries onto it as the first two services — with zero behavior change to the LLM gateway.

**Architecture:** A new `src/server/plugin-core/` module owns a singleton root `cordis.Context`. Two `Service` subclasses (`ExecutorsService`, `ProvidersService`) wrap the existing flat `executors` map and provider-registry array as Cordis services, registered via two small plugins mounted on the root context at `bootstrap()`. Both services delegate to the existing module-level functions/data — no executor or provider logic changes.

**Tech Stack:** TypeScript, `cordis` (npm, MIT, `^4.0.0-rc.8`), vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-plugin-core-design.md`

## Global Constraints

- Adopt the `cordis` npm package directly — do not hand-roll a "Cordis-lite" DI layer (spec decision).
- Zero behavior change: every existing executor/provider lookup continues to resolve exactly as it does today. `plugin-core` is a wrapper, not a rewrite.
- Do not touch the codegen'd `providers/registry/index.ts` import list or its generator — this plan reads its existing `export default [...]` array as-is (spec's flagged risk resolved: no generator changes needed).
- All new tests live in `tests/unit/`, following the existing `describe`/`it` vitest style used by `tests/unit/cloudToolRegistry.test.ts`.
- Use the `@/` path alias for all cross-module imports, matching the rest of the codebase.

---

## Task 1: Root Context bootstrap (no services yet)

**Files:**
- Modify: `package.json` (add `cordis` dependency)
- Create: `src/server/plugin-core/context.ts`
- Test: `tests/unit/pluginCoreContext.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module)
- Produces (used by Tasks 2-3):
  - `bootstrap(): Context` — creates and memoizes the singleton root context
  - `getContext(): Context` — returns the memoized context, throws if `bootstrap()` was never called
  - `resetContext(): Promise<void>` — disposes and clears the singleton (test-only lifecycle control)
  - `export type { Context }` (re-exported from `cordis`)

- [ ] **Step 1: Install `cordis`**

Run: `npm install cordis@^4.0.0-rc.8`
Expected: `package.json` gains `"cordis": "^4.0.0-rc.8"` under `dependencies`, `package-lock.json` updates.

- [ ] **Step 2: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, getContext, resetContext } from "@/server/plugin-core/context";

describe("plugin-core context bootstrap", () => {
  afterEach(async () => {
    await resetContext();
  });

  it("memoizes the root context across calls", () => {
    const first = bootstrap();
    const second = bootstrap();
    expect(second).toBe(first);
  });

  it("throws from getContext() before bootstrap() has run", async () => {
    await resetContext();
    expect(() => getContext()).toThrow();
  });

  it("creates a fresh context after resetContext()", async () => {
    const before = bootstrap();
    await resetContext();
    const after = bootstrap();
    expect(after).not.toBe(before);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/pluginCoreContext.test.ts`
Expected: FAIL — `Cannot find module '@/server/plugin-core/context'`

- [ ] **Step 4: Write `context.ts`**

```ts
import { Context } from "cordis";

let rootContext: Context | null = null;

export function bootstrap(): Context {
  if (!rootContext) {
    rootContext = new Context();
  }
  return rootContext;
}

export function getContext(): Context {
  if (!rootContext) {
    throw new Error("plugin-core: call bootstrap() before getContext()");
  }
  return rootContext;
}

export async function resetContext(): Promise<void> {
  if (rootContext) {
    await rootContext.fiber.dispose();
    rootContext = null;
  }
}

export type { Context };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/pluginCoreContext.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/server/plugin-core/context.ts tests/unit/pluginCoreContext.test.ts
git commit -m "feat: add cordis dependency and plugin-core root context bootstrap"
```

---

## Task 2: Executors service + plugin

**Files:**
- Modify: `src/server/llm-gateway/engine/executors/index.ts` (export the `executors` map)
- Modify: `src/server/plugin-core/context.ts` (mount the executors plugin in `bootstrap()`)
- Create: `src/server/plugin-core/services/executors-service.ts`
- Create: `src/server/plugin-core/plugins/executors-plugin.ts`
- Test: `tests/unit/pluginCoreExecutors.test.ts`

**Interfaces:**
- Consumes: `bootstrap`, `resetContext`, `Context` from Task 1 (`../context`); `getExecutor`, `hasSpecializedExecutor` (already exported by `executors/index.ts`)
- Produces (used by Task 3 only for the shared `bootstrap()` wiring pattern, not for its own logic):
  - `ExecutorsService` class — registers as `ctx.executors`
  - `ctx.executors.get(provider: string): unknown`
  - `ctx.executors.has(provider: string): boolean`
  - `executorsPlugin` — `{ name: string; apply(ctx: Context): void }`

- [ ] **Step 1: Export the existing `executors` map**

In `src/server/llm-gateway/engine/executors/index.ts`, add this line directly after the `executors` object literal (after line 69, before `const defaultCache = new Map();`):

```ts
export { executors };
```

- [ ] **Step 2: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, resetContext } from "@/server/plugin-core/context";
import { executors } from "@/server/llm-gateway/engine/executors";

describe("executors plugin", () => {
  afterEach(async () => {
    await resetContext();
  });

  it("registers ctx.executors with every specialized executor name", () => {
    const ctx = bootstrap();
    for (const name of Object.keys(executors)) {
      expect(ctx.executors.has(name)).toBe(true);
    }
  });

  it("falls back to a cached DefaultExecutor for an unknown provider", () => {
    const ctx = bootstrap();
    expect(ctx.executors.has("totally-unknown-provider")).toBe(false);
    const executor = ctx.executors.get("totally-unknown-provider");
    expect(executor).toBeTruthy();
    expect(ctx.executors.get("totally-unknown-provider")).toBe(executor);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/pluginCoreExecutors.test.ts`
Expected: FAIL — `ctx.executors` is `undefined`

- [ ] **Step 4: Write `services/executors-service.ts`**

```ts
import { Service } from "cordis";
import type { Context } from "cordis";
import { getExecutor, hasSpecializedExecutor } from "@/server/llm-gateway/engine/executors";

declare module "cordis" {
  interface Context {
    executors: ExecutorsService;
  }
}

export class ExecutorsService extends Service {
  constructor(ctx: Context) {
    super(ctx, "executors");
  }

  get(provider: string): unknown {
    return getExecutor(provider);
  }

  has(provider: string): boolean {
    return hasSpecializedExecutor(provider);
  }
}
```

- [ ] **Step 5: Write `plugins/executors-plugin.ts`**

```ts
import type { Context } from "cordis";
import { ExecutorsService } from "../services/executors-service";

export const executorsPlugin = {
  name: "squid-executors",
  apply(ctx: Context): void {
    new ExecutorsService(ctx);
  },
};
```

- [ ] **Step 6: Mount the plugin in `context.ts`**

In `src/server/plugin-core/context.ts`, add the import and mount call:

```ts
import { Context } from "cordis";
import { executorsPlugin } from "./plugins/executors-plugin";

let rootContext: Context | null = null;

export function bootstrap(): Context {
  if (!rootContext) {
    const ctx = new Context();
    ctx.plugin(executorsPlugin);
    rootContext = ctx;
  }
  return rootContext;
}
```

(Leave `getContext()`, `resetContext()`, and the `Context` re-export from Task 1 unchanged.)

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/unit/pluginCoreExecutors.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 9: Commit**

```bash
git add src/server/llm-gateway/engine/executors/index.ts src/server/plugin-core/context.ts src/server/plugin-core/services/executors-service.ts src/server/plugin-core/plugins/executors-plugin.ts tests/unit/pluginCoreExecutors.test.ts
git commit -m "feat: expose the executor registry as a plugin-core service"
```

---

## Task 3: Providers service + plugin

**Files:**
- Modify: `src/server/plugin-core/context.ts` (mount the providers plugin)
- Create: `src/server/plugin-core/services/providers-service.ts`
- Create: `src/server/plugin-core/plugins/providers-plugin.ts`
- Test: `tests/unit/pluginCoreProviders.test.ts`

**Interfaces:**
- Consumes: `bootstrap`, `resetContext`, `Context` from Task 1 (`../context`); the existing `export default [...]` array from `src/server/llm-gateway/engine/providers/registry/index.ts` (each entry has at least an `id: string` field, confirmed against `registry/anthropic.ts`)
- Produces: `ProvidersService` class registering as `ctx.providers`; `ctx.providers.getById(id: string): ProviderConfig | null`; `ctx.providers.getAll(): ProviderConfig[]`; `providersPlugin`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, resetContext } from "@/server/plugin-core/context";
import providerRegistry from "@/server/llm-gateway/engine/providers/registry";

describe("providers plugin", () => {
  afterEach(async () => {
    await resetContext();
  });

  it("registers ctx.providers with every provider id from the registry", () => {
    const ctx = bootstrap();
    for (const provider of providerRegistry) {
      expect(ctx.providers.getById((provider as { id: string }).id)).toBeTruthy();
    }
    expect(ctx.providers.getAll()).toHaveLength(providerRegistry.length);
  });

  it("returns null for an unknown provider id", () => {
    const ctx = bootstrap();
    expect(ctx.providers.getById("does-not-exist")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/pluginCoreProviders.test.ts`
Expected: FAIL — `ctx.providers` is `undefined`

- [ ] **Step 3: Write `services/providers-service.ts`**

```ts
import { Service } from "cordis";
import type { Context } from "cordis";
import providerRegistry from "@/server/llm-gateway/engine/providers/registry";

export interface ProviderConfig {
  id: string;
  [key: string]: unknown;
}

declare module "cordis" {
  interface Context {
    providers: ProvidersService;
  }
}

export class ProvidersService extends Service {
  private map: Map<string, ProviderConfig>;

  constructor(ctx: Context) {
    super(ctx, "providers");
    this.map = new Map((providerRegistry as ProviderConfig[]).map((p) => [p.id, p]));
  }

  getById(id: string): ProviderConfig | null {
    return this.map.get(id) ?? null;
  }

  getAll(): ProviderConfig[] {
    return [...this.map.values()];
  }
}
```

- [ ] **Step 4: Write `plugins/providers-plugin.ts`**

```ts
import type { Context } from "cordis";
import { ProvidersService } from "../services/providers-service";

export const providersPlugin = {
  name: "squid-providers",
  apply(ctx: Context): void {
    new ProvidersService(ctx);
  },
};
```

- [ ] **Step 5: Mount the plugin in `context.ts`**

In `src/server/plugin-core/context.ts`, add the import and mount call so `bootstrap()` reads:

```ts
import { Context } from "cordis";
import { executorsPlugin } from "./plugins/executors-plugin";
import { providersPlugin } from "./plugins/providers-plugin";

let rootContext: Context | null = null;

export function bootstrap(): Context {
  if (!rootContext) {
    const ctx = new Context();
    ctx.plugin(executorsPlugin);
    ctx.plugin(providersPlugin);
    rootContext = ctx;
  }
  return rootContext;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/pluginCoreProviders.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 8: Run the full plugin-core test group together**

Run: `npx vitest run tests/unit/pluginCoreContext.test.ts tests/unit/pluginCoreExecutors.test.ts tests/unit/pluginCoreProviders.test.ts`
Expected: PASS (7 tests total) — confirms `resetContext()` in each file's `afterEach` correctly isolates the three suites when run together.

- [ ] **Step 9: Commit**

```bash
git add src/server/plugin-core/context.ts src/server/plugin-core/services/providers-service.ts src/server/plugin-core/plugins/providers-plugin.ts tests/unit/pluginCoreProviders.test.ts
git commit -m "feat: expose the provider registry as a plugin-core service"
```

---

**Spec coverage:** Root `Context` + bootstrap/dispose lifecycle (Task 1), `ctx.executors` service wrapping the existing executor map with zero behavior change (Task 2), `ctx.providers` service wrapping the existing provider registry array (Task 3) — every section of `2026-08-28-plugin-core-design.md` has a task. The event bus, `ctx.sessions`/`ctx.tools`/`ctx.memory`, MCP, scheduling, and the chat/agent UI remain explicitly out of scope, per the spec's "Out of scope" section — future sub-projects.
