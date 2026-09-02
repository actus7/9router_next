# Chat UI Upgrade + Plugin-Core Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish proving the plugin-core system with an easy-to-test provider, and bring the basic-chat UI up to the density/information level of the reference harness screenshots (compact stats bar, per-message usage detail, reasoning-effort selector, context-used meter, collapsible search, and a richer Trajectory view).

**Architecture:** Each phase below is independent and separately shippable — they touch different files and can be executed (and reviewed) in any order after Phase 0. Phases 1-2 add timing/usage instrumentation to the existing streaming pipeline (`useSendMessage.ts` → `finalizeStreamResult.ts`) and surface it in two places (composer stats bar, per-message popover). Phase 3 adds a new request parameter (`reasoning_effort`) the server already understands but the UI never sends. Phase 4 is a pure UI menu extraction. Phase 5 is a client-side heuristic (no real tokenizer available) context meter. Phase 6 converts two always-open inputs into disclosure-pattern toggles. Phase 7 extends the existing Run Journal data model with an event-type taxonomy and a real per-turn detail list, matching the reference "Trajectory" tab.

**Tech Stack:** Next.js App Router, React (client components), TypeScript, Tailwind v4 (existing tokens in `globals.css`), shadcn/ui primitives already in `src/components/ui/` (Popover, Badge, Button, Input — reuse before adding new primitives), Vitest for tests, Cordis (plugin-core only, Phase 0).

**Spec:** No separate spec file — this plan was authorized directly by the user after an in-chat design discussion (see conversation). The design decisions are captured inline in each phase below.

## Global Constraints

- Follow `docs/CONVENTIONS.md`: components 200-400 lines target, hooks per state domain, no `console.log`, no dead code left behind when touching a file.
- Every new/changed piece of business logic gets a Vitest unit test under `tests/unit/` (project convention — tests live outside `src/`).
- No new npm dependencies — everything below is buildable with primitives already in `src/components/ui/` and Tailwind utilities already used elsewhere in `basic-chat/`.
- Client-side "context used" and "cache hit" numbers are estimates/pass-throughs of provider-reported data, never a promise of exact provider-side token accounting — label them accordingly in the UI (`~` prefix, matching the reference screenshot's own `~8.7K / 1M`).
- Run `npm run check` (lint + typecheck + contract:check + test:coverage + build + git diff --check) before considering any phase done, per `AGENTS.md`'s "Definição de pronto".

---

## Phase 0: Plugin-core proof — swap to `opencode`

The earlier proof-of-concept migrated `xiaomi-tokenplan` into `corePlugins`. The user asked to redo it with `opencode` instead, because `opencode`'s executor sends `Authorization: Bearer public` (`src/server/llm-gateway/engine/executors/opencode.ts:64`) — no real account/credentials needed, so it's testable by literally sending a chat request with `model: "opencode/<any-model>"` and no provider connection configured.

### Task 0.1: Revert the xiaomi-tokenplan plugin and register opencode instead

**Files:**
- Delete: `src/server/plugin-core/plugins/xiaomi-tokenplan-plugin.ts`
- Create: `src/server/plugin-core/plugins/opencode-plugin.ts`
- Modify: `src/server/plugin-core/plugins/registry.ts` (swap the import/array entry)
- Modify: `src/server/llm-gateway/engine/executors/index.ts` (restore the static `xiaomi-tokenplan` entry, remove the static `opencode` entry)
- Modify: `tests/unit/pluginCoreExecutors.test.ts` (swap the end-to-end assertion)

**Interfaces:**
- Consumes: `CorePlugin` interface from `registry.ts` (`{ name: string; inject?: string[]; apply(ctx): void | Promise<void> }`), `OpenCodeExecutor` from `../../llm-gateway/engine/executors/opencode`.
- Produces: `opencodePlugin: CorePlugin`, exported for `registry.ts` to import.

- [x] **Step 1: Restore the static xiaomi-tokenplan registration**

In `src/server/llm-gateway/engine/executors/index.ts`, re-add the import that Phase-0-of-the-previous-round removed:

```ts
import { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan";
```

Add back into the `executors` object:

```ts
  "xiaomi-tokenplan": new XiaomiTokenplanExecutor(),
```

Then remove the **opencode** static entry and its import — delete this line:

```ts
import { OpenCodeExecutor } from "./opencode";
```

and this line:

```ts
  opencode: new OpenCodeExecutor(),
```

- [x] **Step 2: Delete the old plugin file and create the new one**

Delete `src/server/plugin-core/plugins/xiaomi-tokenplan-plugin.ts`.

Create `src/server/plugin-core/plugins/opencode-plugin.ts`:

```ts
import type { Context } from "cordis";
import type { CorePlugin } from "./registry";
import { OpenCodeExecutor } from "@/server/llm-gateway/engine/executors/opencode";

/**
 * Registers the opencode executor through the plugin overlay instead of the
 * static executors map — proves the plugin-core registration path is wired
 * into the chat hot path (see executors/index.ts). Chosen because opencode
 * authenticates with a public sentinel token (no real account needed), so
 * this plugin is testable end-to-end with zero configured credentials.
 */
export const opencodePlugin: CorePlugin = {
  name: "opencode",
  inject: ["executors"],
  apply(ctx: Context): void {
    ctx.executors.register("opencode", new OpenCodeExecutor());
  },
};
```

- [x] **Step 3: Point the registry at the new plugin**

In `src/server/plugin-core/plugins/registry.ts`, replace:

```ts
import { xiaomiTokenplanPlugin } from "./xiaomi-tokenplan-plugin";
```

with:

```ts
import { opencodePlugin } from "./opencode-plugin";
```

and replace:

```ts
export const corePlugins: CorePlugin[] = [xiaomiTokenplanPlugin];
```

with:

```ts
export const corePlugins: CorePlugin[] = [opencodePlugin];
```

- [x] **Step 4: Update the end-to-end plugin test**

In `tests/unit/pluginCoreExecutors.test.ts`, replace the import:

```ts
import { XiaomiTokenplanExecutor } from "@/server/llm-gateway/engine/executors/xiaomi-tokenplan";
```

with:

```ts
import { OpenCodeExecutor } from "@/server/llm-gateway/engine/executors/opencode";
```

Replace the test body (same name is fine to keep, or rename — rename for clarity):

```ts
  it("opencode resolves through the real opencodePlugin, not a static entry", async () => {
    await bootstrap();
    expect(executors).not.toHaveProperty("opencode");
    expect(getExecutor("opencode")).toBeInstanceOf(OpenCodeExecutor);
    expect(hasSpecializedExecutor("opencode")).toBe(true);
  });
```

- [x] **Step 5: Run the plugin-core tests**

Run: `npx vitest run tests/unit/pluginCoreExecutors.test.ts tests/unit/pluginCoreContext.test.ts tests/unit/pluginCoreProviders.test.ts`
Expected: all pass, including the new opencode assertion.

- [x] **Step 6: Run the full check**

Run: `npm run check`
Expected: exit 0 (lint, typecheck, contract, coverage, build all green).

- [x] **Step 7: Commit**

```bash
git add src/server/plugin-core/plugins/opencode-plugin.ts src/server/plugin-core/plugins/registry.ts src/server/llm-gateway/engine/executors/index.ts tests/unit/pluginCoreExecutors.test.ts
git rm src/server/plugin-core/plugins/xiaomi-tokenplan-plugin.ts
git commit -m "refactor: swap plugin-core proof-of-concept from xiaomi-tokenplan to opencode"
```

---

## Phase 1: Turn timing + composer stats bar

Add a compact stats line under the composer, matching the reference: `N turns · N steps | LLM Xs | TTFT avg Xs · X tok/s | Cache hit X% | Input X tok · Output X tok`. This requires instrumenting the streaming pipeline to capture timing, since none exists today.

**Semantics chosen** (no existing precedent in this codebase, so defined here for consistency across Phases 1-2-7):
- **Turn** = one user message + its resulting assistant message(s) in the active session (`session.messages.filter(m => m.role === "user").length`).
- **Step** = number of tool-call round-trips in the *last* run (`useSendMessage.ts`'s `step` loop, already bounded at 8 — see line 173 `for (let step = 0; step < 8 ...)`). Exposed by counting `assistant` messages with `role === "assistant"` since the last `user` message.
- **LLM Xs** = `totalMs` of the last completed assistant message's model round-trip (fetch start → stream done), in seconds, 1 decimal.
- **TTFT avg Xs** = average `ttftMs` (time to first streamed token) across all assistant messages in the current session with recorded timing, in seconds.
- **tok/s** = last assistant message's `completion_tokens / (totalMs / 1000)`.
- **Cache hit %** = last assistant message's `tokenUsage.cached_tokens / tokenUsage.prompt_tokens * 100`, omitted entirely if `cached_tokens` is absent (not every provider reports it).

### Task 1.1: Extend `TokenUsage` and add a `MessageTiming` type

**Files:**
- Modify: `src/app/(dashboard)/dashboard/basic-chat/types.ts`
- Test: `tests/unit/chatFormatUtils.test.ts` (extend existing `readStreamUsage` tests if present, else create the cached-tokens case there)

**Interfaces:**
- Produces: `TokenUsage.cached_tokens?: number`, new `MessageTiming { ttftMs: number; totalMs: number }`, `ChatMessage.timing?: MessageTiming`.

- [x] **Step 1: Add the fields**

In `types.ts`, change:

```ts
export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}
```

to:

```ts
export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cached_tokens?: number;
}

export interface MessageTiming {
  /** Time from request start to the first streamed token, in milliseconds. */
  ttftMs: number;
  /** Total time from request start to stream completion, in milliseconds. */
  totalMs: number;
}
```

Add `timing?: MessageTiming;` to `ChatMessage`, right after the existing `tokenUsage?: TokenUsage;` line.

- [x] **Step 2: Parse `cached_tokens` from the stream**

In `src/app/(dashboard)/dashboard/basic-chat/chatFormatUtils.ts`, change `readStreamUsage` (around line 116-124) to also read the OpenAI-style nested field and the Anthropic-style flat field:

```ts
export function readStreamUsage(chunk: Record<string, unknown>): TokenUsage | null {
  const usage = chunk?.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return null;
  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const cachedTokens = Number(promptDetails?.cached_tokens ?? usage.cache_read_input_tokens ?? 0) || 0;
  return {
    prompt_tokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0,
    completion_tokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0,
    total_tokens: Number(usage.total_tokens ?? 0) || undefined,
    ...(cachedTokens > 0 ? { cached_tokens: cachedTokens } : {}),
  };
}
```

- [x] **Step 3: Write the test**

In `tests/unit/chatFormatUtils.test.ts` (create the file if it does not exist yet, following the pattern of other `tests/unit/*.test.ts` files — `import { describe, expect, it } from "vitest";` then `import { readStreamUsage } from "@/app/(dashboard)/dashboard/basic-chat/chatFormatUtils";`), add:

```ts
describe("readStreamUsage", () => {
  it("parses OpenAI-style nested cached tokens", () => {
    const result = readStreamUsage({ usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 } } });
    expect(result).toEqual({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cached_tokens: 40 });
  });

  it("parses Anthropic-style flat cache_read_input_tokens", () => {
    const result = readStreamUsage({ usage: { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 15 } });
    expect(result?.cached_tokens).toBe(15);
  });

  it("omits cached_tokens when the provider reports none", () => {
    const result = readStreamUsage({ usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
    expect(result).toEqual({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
  });
});
```

- [x] **Step 4: Run the test**

Run: `npx vitest run tests/unit/chatFormatUtils.test.ts`
Expected: PASS (3 new tests).

- [x] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/basic-chat/types.ts src/app/\(dashboard\)/dashboard/basic-chat/chatFormatUtils.ts tests/unit/chatFormatUtils.test.ts
git commit -m "feat: parse provider cache-hit token counts and add message timing type"
```

### Task 1.2: Capture TTFT/total timing in `useSendMessage.ts` and persist it via `finalizeStreamResult.ts`

**Files:**
- Modify: `src/app/(dashboard)/dashboard/basic-chat/hooks/finalizeStreamResult.ts`
- Modify: `src/app/(dashboard)/dashboard/basic-chat/hooks/useSendMessage.ts`
- Test: `tests/unit/finalizeStreamResult.test.ts` (extend, or create following the sibling `tests/unit/*.test.ts` pattern)

**Interfaces:**
- Consumes: `MessageTiming` from `types.ts` (Task 1.1).
- Produces: `StreamTelemetry.timing?: MessageTiming` (new field), `finalizeStreamSuccess(...)` stores it on the message.

- [x] **Step 1: Extend `StreamTelemetry` and store `timing` on the message**

In `finalizeStreamResult.ts`, add `timing?: MessageTiming | null;` to the `StreamTelemetry` interface (import `MessageTiming` from `../types`), and in `finalizeStreamSuccess`, alongside the existing `tokenUsage: telemetry.usage ?? m.tokenUsage` line, add `timing: telemetry.timing ?? m.timing`.

- [x] **Step 2: Write the failing test**

Add to `tests/unit/finalizeStreamResult.test.ts` (if the file doesn't exist, create it importing `finalizeStreamSuccess` the same way existing hook tests import from `hooks/`):

```ts
it("stores timing telemetry on the finalized message", () => {
  const messages = [{ id: "assistant-1", role: "assistant", content: "", status: "streaming" as const }];
  let session = { id: "s1", messages } as unknown as import("@/app/(dashboard)/dashboard/basic-chat/types").ChatSession;
  const updateSession = (_id: string, updater: (s: typeof session) => typeof session) => { session = updater(session); };
  finalizeStreamSuccess("s1", "assistant-1", "hello", "hi", updateSession, () => {}, { timing: { ttftMs: 400, totalMs: 1200 } });
  expect(session.messages[0].timing).toEqual({ ttftMs: 400, totalMs: 1200 });
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/unit/finalizeStreamResult.test.ts`
Expected: FAIL (`timing` is `undefined`) if run before Step 1's edit lands. If Step 1 was already applied, this will already PASS — either order is fine as long as both the test and the implementation exist before moving on.

- [x] **Step 4: Instrument timing capture in `useSendMessage.ts`**

Around line 106 (right before `const fetchOptions = ...`), capture the start time:

```ts
    const requestStartedAt = Date.now();
    let firstTokenAt: number | null = null;
```

Wrap the existing `updateStreamingText` callback (line 109) to record the first-token timestamp on its first real invocation — change:

```ts
      const updateStreamingText = (text: string) => {
        setStreamingText(text);
```

to:

```ts
      const updateStreamingText = (text: string) => {
        if (firstTokenAt === null && text) firstTokenAt = Date.now();
        setStreamingText(text);
```

Then, where `finalizeStreamSuccess` is called (line 135), compute and pass `timing`:

```ts
      if (result.streamed) {
        const completedAt = Date.now();
        const timing = { ttftMs: (firstTokenAt ?? completedAt) - requestStartedAt, totalMs: completedAt - requestStartedAt };
        finalizeStreamSuccess(sessionId, assistantMessageId, result.text, userText, updateSession, recordHarnessEvent, { reasoning: result.reasoning, usage: result.usage, responseSource: result.responseSource, timing });
      } else {
```

- [x] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/finalizeStreamResult.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/basic-chat/hooks/finalizeStreamResult.ts src/app/\(dashboard\)/dashboard/basic-chat/hooks/useSendMessage.ts tests/unit/finalizeStreamResult.test.ts
git commit -m "feat: capture time-to-first-token and total turn duration"
```

### Task 1.3: Build the composer stats bar

**Files:**
- Create: `src/app/(dashboard)/dashboard/basic-chat/sections/ChatUsageBar.tsx`
- Create: `src/app/(dashboard)/dashboard/basic-chat/sections/chatUsageBarStats.ts`
- Modify: `src/app/(dashboard)/dashboard/basic-chat/sections/ChatComposer.tsx`
- Test: `tests/unit/chatUsageBarStats.test.ts`

**Interfaces:**
- Consumes: `ChatSession["messages"]` (from `types.ts`, already defined).
- Produces: `computeUsageBarStats(messages: ChatMessage[]): UsageBarStats | null` (pure function, exported for the test), `<ChatUsageBar messages={...} />` component.

- [x] **Step 1: Write the pure stats-computation function with its test first**

Create `src/app/(dashboard)/dashboard/basic-chat/sections/chatUsageBarStats.ts`:

```ts
import type { ChatMessage } from "../types";

export interface UsageBarStats {
  turns: number;
  steps: number;
  lastRunSeconds: number | null;
  avgTtftSeconds: number | null;
  tokensPerSecond: number | null;
  cacheHitPercent: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Derives the composer stats-bar numbers from the active session's messages, or null if nothing has run yet. */
export function computeUsageBarStats(messages: ChatMessage[]): UsageBarStats | null {
  const assistantMessages = messages.filter((m) => m.role === "assistant" && m.status === "done");
  if (assistantMessages.length === 0) return null;

  const turns = messages.filter((m) => m.role === "user").length;
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
  const steps = messages.slice(lastUserIndex + 1).filter((m) => m.role === "assistant").length;

  const last = assistantMessages[assistantMessages.length - 1]!;
  const timed = assistantMessages.filter((m) => m.timing);
  const avgTtftSeconds = timed.length > 0
    ? timed.reduce((sum, m) => sum + m.timing!.ttftMs, 0) / timed.length / 1000
    : null;

  const usage = last.tokenUsage;
  const totalMs = last.timing?.totalMs;
  const tokensPerSecond = usage?.completion_tokens && totalMs
    ? usage.completion_tokens / (totalMs / 1000)
    : null;
  const cacheHitPercent = usage?.cached_tokens && usage.prompt_tokens
    ? (usage.cached_tokens / usage.prompt_tokens) * 100
    : null;

  return {
    turns,
    steps,
    lastRunSeconds: totalMs ? totalMs / 1000 : null,
    avgTtftSeconds,
    tokensPerSecond,
    cacheHitPercent,
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
  };
}
```

- [x] **Step 2: Write the test**

Create `tests/unit/chatUsageBarStats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeUsageBarStats } from "@/app/(dashboard)/dashboard/basic-chat/sections/chatUsageBarStats";
import type { ChatMessage } from "@/app/(dashboard)/dashboard/basic-chat/types";

describe("computeUsageBarStats", () => {
  it("returns null when no assistant message has completed", () => {
    expect(computeUsageBarStats([{ id: "u1", role: "user", content: "hi" }])).toBeNull();
  });

  it("computes turns, steps, and per-token rate from the last completed assistant message", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "hello", status: "done", timing: { ttftMs: 500, totalMs: 2000 }, tokenUsage: { prompt_tokens: 100, completion_tokens: 50, cached_tokens: 40 } },
    ];
    const stats = computeUsageBarStats(messages);
    expect(stats).toMatchObject({ turns: 1, steps: 1, lastRunSeconds: 2, avgTtftSeconds: 0.5, tokensPerSecond: 25, cacheHitPercent: 40, inputTokens: 100, outputTokens: 50 });
  });

  it("counts multiple assistant steps (tool-call round-trips) after the last user message", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "", status: "done", toolCalls: [{ id: "c1", name: "web_search", arguments: "{}" }] },
      { id: "t1", role: "tool", toolCallId: "c1", content: "{}" },
      { id: "a2", role: "assistant", content: "done", status: "done", timing: { ttftMs: 300, totalMs: 900 } },
    ];
    expect(computeUsageBarStats(messages)?.steps).toBe(2);
  });

  it("omits cache hit percent when no cached tokens were reported", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "hello", status: "done", tokenUsage: { prompt_tokens: 100, completion_tokens: 50 } },
    ];
    expect(computeUsageBarStats(messages)?.cacheHitPercent).toBeNull();
  });
});
```

- [x] **Step 3: Run the test to verify it passes**

Run: `npx vitest run tests/unit/chatUsageBarStats.test.ts`
Expected: PASS (4 tests).

- [x] **Step 4: Build the display component**

Create `src/app/(dashboard)/dashboard/basic-chat/sections/ChatUsageBar.tsx`:

```tsx
"use client";

import { computeUsageBarStats } from "./chatUsageBarStats";
import type { ChatMessage } from "../types";

interface ChatUsageBarProps {
  messages: ChatMessage[];
}

/** Compact stats line under the composer: turns/steps, last-run latency, throughput, cache hit, token counts. */
export default function ChatUsageBar({ messages }: ChatUsageBarProps) {
  const stats = computeUsageBarStats(messages);
  if (!stats) return null;

  const parts: string[] = [`${stats.turns} turn${stats.turns === 1 ? "" : "s"} · ${stats.steps} step${stats.steps === 1 ? "" : "s"}`];
  if (stats.lastRunSeconds !== null) parts.push(`LLM ${stats.lastRunSeconds.toFixed(1)}s`);
  if (stats.avgTtftSeconds !== null && stats.tokensPerSecond !== null) {
    parts.push(`TTFT avg ${stats.avgTtftSeconds.toFixed(1)}s · ${stats.tokensPerSecond.toFixed(0)} tok/s`);
  }
  if (stats.cacheHitPercent !== null) parts.push(`Cache hit ${stats.cacheHitPercent.toFixed(0)}%`);
  if (stats.inputTokens !== null && stats.outputTokens !== null) {
    parts.push(`Input ${stats.inputTokens} tok · Output ${stats.outputTokens} tok`);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 pb-2">
      <p className="truncate text-center text-[11px] text-muted-foreground">{parts.join("  |  ")}</p>
    </div>
  );
}
```

- [x] **Step 5: Wire it into `ChatComposer.tsx`**

In `ChatComposer.tsx`, add the import at the top:

```ts
import ChatUsageBar from "./ChatUsageBar";
```

`currentSession` is already destructured from `sessionsHook` at line 21. Insert the bar right after the closing `</div>` of the input box (after line 148, before the outer wrapper's closing `</div>` at line 149):

```tsx
        </div>
      </div>
      <ChatUsageBar messages={currentSession?.messages ?? []} />
    </div>
```

(This replaces the existing bare `</div>\n    </div>` at the end of the file — the new `<ChatUsageBar />` line goes between the two closing divs, matching the outer `shrink-0 border-t ...` wrapper.)

- [x] **Step 6: Run the full test suite for this task and typecheck**

Run: `npx vitest run tests/unit/chatUsageBarStats.test.ts tests/unit/finalizeStreamResult.test.ts tests/unit/chatFormatUtils.test.ts && npx tsc --noEmit --pretty false`
Expected: all PASS, 0 type errors.

- [x] **Step 7: Manually verify in the browser**

Start the dev server (`npm run dev`), open `/dashboard/basic-chat`, send a message, and confirm the stats line appears under the composer after the response completes, with plausible numbers (no `NaN`, no `undefined`).

- [x] **Step 8: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/basic-chat/sections/ChatUsageBar.tsx src/app/\(dashboard\)/dashboard/basic-chat/sections/chatUsageBarStats.ts src/app/\(dashboard\)/dashboard/basic-chat/sections/ChatComposer.tsx tests/unit/chatUsageBarStats.test.ts
git commit -m "feat: add compact usage stats bar under the chat composer"
```

---

## Phase 2: Per-message usage popover

Reference screenshot: clicking the small "Usage 8.7K tok" pill on a message opens a popover with `Provider / model`, `Cache hit`, `Uncached input`, `Cached input`, `Output`. A second popover on the "Ran for 9s" pill shows `Total run time`, `Tokens per second`, `Time to first token`.

### Task 2.1: Build the usage/timing popovers and wire them into assistant messages

**Files:**
- Modify: `src/app/(dashboard)/dashboard/basic-chat/sections/ChatMessageList.tsx`
- Check: `src/components/ui/popover.tsx` exists (shadcn Popover — if absent, check `components.json` → `aliases.ui` per `docs/CONVENTIONS.md` before adding a new primitive; do not duplicate)

**Interfaces:**
- Consumes: `ChatMessage.tokenUsage`, `ChatMessage.timing`, `ChatMessage.providerName`, `ChatMessage.modelName` (all already defined in `types.ts`).

- [x] **Step 1: Confirm the Popover primitive exists**

Run: `ls src/components/ui/popover.tsx 2>/dev/null || echo MISSING`
Expected: prints the file path. If it prints `MISSING`, run `npx shadcn@latest add popover` (the project already uses shadcn — check `components.json` for the configured registry) before continuing, and re-run `npm run check` once to confirm the generated file matches existing lint rules.

- [x] **Step 2: Replace the plain token-count text with two clickable popovers**

In `ChatMessageList.tsx`, locate the existing inline usage rendering (around line 279-285, the small `total_tokens` count). Replace it with (import `Popover, PopoverContent, PopoverTrigger` from `@/components/ui/popover` at the top of the file, and `Badge` is already imported):

```tsx
                {isAssistant && !isStreaming && message.tokenUsage && (
                  <div className="mt-2 flex items-center gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                          <Hash className="size-2.5" />
                          Usage {((message.tokenUsage.total_tokens ?? ((message.tokenUsage.prompt_tokens ?? 0) + (message.tokenUsage.completion_tokens ?? 0))) / 1000).toFixed(1)}K tok
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 text-xs" align="start">
                        <dl className="grid grid-cols-2 gap-y-1.5">
                          <dt className="text-muted-foreground">Provider / model</dt>
                          <dd className="text-right font-medium">{message.providerName ?? "—"}/{message.modelName ?? "—"}</dd>
                          {message.tokenUsage.cached_tokens != null && message.tokenUsage.prompt_tokens ? (
                            <>
                              <dt className="text-muted-foreground">Cache hit</dt>
                              <dd className="text-right font-medium">{((message.tokenUsage.cached_tokens / message.tokenUsage.prompt_tokens) * 100).toFixed(1)}%</dd>
                            </>
                          ) : null}
                          <dt className="text-muted-foreground">Uncached input</dt>
                          <dd className="text-right font-medium">{(message.tokenUsage.prompt_tokens ?? 0) - (message.tokenUsage.cached_tokens ?? 0)} tok</dd>
                          {message.tokenUsage.cached_tokens != null && (
                            <>
                              <dt className="text-muted-foreground">Cached input</dt>
                              <dd className="text-right font-medium">{message.tokenUsage.cached_tokens} tok</dd>
                            </>
                          )}
                          <dt className="text-muted-foreground">Output</dt>
                          <dd className="text-right font-medium">{message.tokenUsage.completion_tokens ?? 0} tok</dd>
                        </dl>
                      </PopoverContent>
                    </Popover>
                    {message.timing && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                            Ran for {(message.timing.totalMs / 1000).toFixed(0)}s
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 text-xs" align="start">
                          <dl className="grid grid-cols-2 gap-y-1.5">
                            <dt className="text-muted-foreground">Total run time</dt>
                            <dd className="text-right font-medium">{(message.timing.totalMs / 1000).toFixed(1)}s</dd>
                            <dt className="text-muted-foreground">Tokens per second</dt>
                            <dd className="text-right font-medium">
                              {message.tokenUsage.completion_tokens ? (message.tokenUsage.completion_tokens / (message.timing.totalMs / 1000)).toFixed(0) : "—"} tok/s
                            </dd>
                            <dt className="text-muted-foreground">Time to first token</dt>
                            <dd className="text-right font-medium">{(message.timing.ttftMs / 1000).toFixed(1)}s</dd>
                          </dl>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                )}
```

Remove whatever the old inline single-line token count rendering was (the one this block replaces), keeping the rest of the message actions row (copy/retry/feedback buttons) untouched.

- [x] **Step 3: Manually verify in the browser**

Send a message, wait for completion, click the "Usage" pill — confirm the popover opens with the breakdown and closes on outside click. Click "Ran for Xs" — confirm the timing popover opens.

- [x] **Step 4: Run lint and typecheck**

Run: `npx eslint "src/app/(dashboard)/dashboard/basic-chat/sections/ChatMessageList.tsx" && npx tsc --noEmit --pretty false`
Expected: 0 errors.

- [x] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/basic-chat/sections/ChatMessageList.tsx
git commit -m "feat: add per-message usage and timing popovers"
```

---

## Phase 3: Reasoning-effort selector

The server already accepts and translates `reasoning_effort` (`src/server/llm-gateway/engine/translator/concerns/paramSupport.ts:15`, `capabilities.ts:125,157,256,269`) — the chat UI never sends it. This phase adds the missing client-side piece only.

### Task 3.1: Add `reasoningEffort` state, persistence, and wire it into the request body

**Files:**
- Modify: `src/app/(dashboard)/dashboard/basic-chat/hooks/useChatSessions.ts` (state, mirroring `temperature`)
- Modify: `src/app/(dashboard)/dashboard/basic-chat/hooks/chatSessionStorage.ts` (persistence, mirroring `temperature`)
- Modify: `src/app/(dashboard)/dashboard/basic-chat/hooks/useSessionPersistence.ts` (hydration, mirroring `temperature`)
- Modify: `src/app/(dashboard)/dashboard/basic-chat/hooks/buildChatRequest.ts` (request body)
- Modify: `src/app/(dashboard)/dashboard/basic-chat/hooks/useSendMessage.ts` (thread the value through)
- Modify: `src/app/(dashboard)/dashboard/basic-chat/hooks/useSendMessageTypes.ts` (arg type)
- Modify: `src/app/(dashboard)/dashboard/basic-chat/BasicChatPageClient.tsx` (pass it into `useSendMessage`)
- Test: `tests/unit/buildChatRequest.test.ts` (extend existing file)

**Interfaces:**
- Produces: `buildChatFetchOptions(model, messages, temperature, apiKey, signal, tools?, reasoningEffort?)` with `reasoningEffort: "low" | "medium" | "high" | null`.

- [x] **Step 1: Add the state**

In `useChatSessions.ts`, add near the `temperature` state (line 85):

```ts
const [reasoningEffort, setReasoningEffort] = useState<"low" | "medium" | "high" | null>(null);
```

Add `reasoningEffort` and `setReasoningEffort` to the returned object (mirroring how `temperature`/`setTemperature` are both in the destructured return around line 138) and to the `UseChatSessionsReturn` interface (mirroring line 34), as:

```ts
reasoningEffort: "low" | "medium" | "high" | null; setReasoningEffort: React.Dispatch<React.SetStateAction<"low" | "medium" | "high" | null>>;
```

- [x] **Step 2: Persist it like `temperature`**

In `chatSessionStorage.ts`: add `reasoningEffort: "basic-chat.reasoningEffort"` to `STORAGE_KEYS` (next to the `temperature` entry at line 11). In the load function (around line 48-49, mirroring the `savedTemperature` read), add:

```ts
  const savedReasoningEffort = globalThis.localStorage.getItem(STORAGE_KEYS.reasoningEffort);
  const reasoningEffort: "low" | "medium" | "high" | null =
    savedReasoningEffort === "low" || savedReasoningEffort === "medium" || savedReasoningEffort === "high" ? savedReasoningEffort : null;
```

Add `reasoningEffort` to the returned load object (mirroring line 64) and to the load return type (mirroring line 29) as `reasoningEffort: "low" | "medium" | "high" | null;`.

In the save function, add the corresponding param to its type (mirroring line 75) and persist it (mirroring line 86):

```ts
  globalThis.localStorage.setItem(STORAGE_KEYS.reasoningEffort, params.reasoningEffort ?? "");
```

- [x] **Step 3: Wire hydration**

In `useSessionPersistence.ts`, add `reasoningEffort` to the destructured load result (mirroring line 46) and call `setReasoningEffort(saved.reasoningEffort)` next to `setTemperature(saved.temperature)` (line 66). Add `reasoningEffort` to the save-effect's dependency array and payload (mirroring lines 194 and 199).

- [x] **Step 4: Write the failing test for the request body**

In `tests/unit/buildChatRequest.test.ts`, add:

```ts
it("includes reasoning_effort in the request body when set, omits it when null", () => {
  const withEffort = buildChatFetchOptions(model, [], 0.7, "", new AbortController().signal, undefined, "high");
  expect(JSON.parse(String(withEffort.body)).reasoning_effort).toBe("high");

  const withoutEffort = buildChatFetchOptions(model, [], 0.7, "", new AbortController().signal, undefined, null);
  expect(JSON.parse(String(withoutEffort.body))).not.toHaveProperty("reasoning_effort");
});
```

- [x] **Step 5: Run it to verify it fails**

Run: `npx vitest run tests/unit/buildChatRequest.test.ts`
Expected: FAIL (`buildChatFetchOptions` doesn't accept a 7th argument yet).

- [x] **Step 6: Implement**

In `buildChatRequest.ts`, change the `buildChatFetchOptions` signature to add the parameter and include it conditionally in the body:

```ts
export function buildChatFetchOptions(
  model: NormalizedModel,
  requestMessages: Array<Record<string, unknown>>,
  temperature: number,
  apiKey: string,
  signal: AbortSignal,
  tools?: readonly ToolDefinition[],
  reasoningEffort?: "low" | "medium" | "high" | null,
): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: model.requestModel || model.id,
      messages: requestMessages,
      stream: true,
      stream_options: { include_usage: true },
      temperature,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
    }),
    signal,
  };
}
```

- [x] **Step 7: Thread `reasoningEffort` through `useSendMessage.ts`**

Add `reasoningEffort` to `UseSendMessageArgs` in `useSendMessageTypes.ts` (mirroring `temperature: number;` at line 24) as `reasoningEffort: "low" | "medium" | "high" | null;`. In `useSendMessage.ts`, destructure it from the hook args (line 23, next to `temperature`), pass it as the 7th argument at both `buildChatFetchOptions` call sites (lines 106 and 223), and add it to the `useCallback` dependency array (line 291, next to `temperature`).

In `BasicChatPageClient.tsx` (line 42 area, where `temperature: sessionsHook.temperature` is passed into the `useSendMessage` args object), add `reasoningEffort: sessionsHook.reasoningEffort,`.

- [x] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/unit/buildChatRequest.test.ts`
Expected: PASS.

- [x] **Step 9: Run full typecheck**

Run: `npx tsc --noEmit --pretty false`
Expected: 0 errors (this touches many files' signatures — this step catches any missed call site).

- [x] **Step 10: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/basic-chat/hooks/ src/app/\(dashboard\)/dashboard/basic-chat/BasicChatPageClient.tsx
git commit -m "feat: add reasoning-effort state, persistence, and wire it into chat requests"
```

### Task 3.2: Add the Effort UI control next to the model name

**Files:**
- Modify: `src/app/(dashboard)/dashboard/basic-chat/sections/ChatComposer.tsx`

**Interfaces:**
- Consumes: `reasoningEffort`/`setReasoningEffort` from `sessionsHook` (Task 3.1).

- [x] **Step 1: Replace the plain model-name `<span>` with a popover-triggering button**

In `ChatComposer.tsx`, destructure `reasoningEffort, setReasoningEffort` from `sessionsHook` (line 20-22). Replace the existing model-name span (line 83-85):

```tsx
              <span className="text-[11px] font-medium text-muted-foreground truncate max-w-[140px]">
                {activeModel ? activeModel.name : (translate("No model") || "No model")}
              </span>
```

with a `Popover` (import `Popover, PopoverContent, PopoverTrigger` from `@/components/ui/popover` at the top of the file):

```tsx
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground truncate max-w-[180px]">
                    {activeModel ? activeModel.name : (translate("No model") || "No model")}
                    {reasoningEffort && <span className="text-muted-foreground/70">· {reasoningEffort}</span>}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="start">
                  <p className="px-2 pt-1 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{translate("Effort") || "Effort"}</p>
                  {(["low", "medium", "high"] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setReasoningEffort(reasoningEffort === level ? null : level)}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs capitalize hover:bg-muted ${reasoningEffort === level ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                    >
                      {level}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
```

(Model *switching* stays on the existing `ChatModelPickerModal`, opened elsewhere in the top bar — this popover only adds the effort control next to the model's display name, matching the reference screenshot's "Model / Effort" two-row popover minus the redundant model-switch row, since that already exists via `ChatTopBar.tsx`.)

- [x] **Step 2: Manually verify in the browser**

Click the model name in the composer — confirm the Low/Medium/High popover opens, selecting one shows `· high` (etc.) next to the model name, and clicking the same level again clears it back to no suffix.

- [x] **Step 3: Run lint and typecheck**

Run: `npx eslint "src/app/(dashboard)/dashboard/basic-chat/sections/ChatComposer.tsx" && npx tsc --noEmit --pretty false`
Expected: 0 errors.

- [x] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/basic-chat/sections/ChatComposer.tsx
git commit -m "feat: add reasoning-effort selector to the composer"
```

---

## Phase 4: Separate "+" commands menu from the attach button

Reference: a `+` button opens a command palette (compact, export, feedback, goal, permission, plan, model...); attach stays a separate, always-visible paperclip icon next to it. Today only the paperclip exists (`ChatComposer.tsx:79-82`).

**Scope decision:** implement the menu shell plus the commands that already have a working implementation elsewhere in the codebase (`export` → `handleExportConversation`, already in `UseSendMessageReturn`; `plan` → the existing Agente/Plano toggle at `ChatComposer.tsx:86-97`, exposed here as a menu item too for discoverability). Commands with no backing implementation today (`compact`, `feedback`, `goal`, `permission`) are **out of scope** for this plan — each would need its own design (e.g., "goal" implies a new persisted field; "permission" implies a sandbox/approval concept this codebase doesn't have). Add them as disabled/greyed menu entries with a "coming soon" title so the menu shape matches the reference without faking functionality.

### Task 4.1: Build the commands menu

**Files:**
- Create: `src/app/(dashboard)/dashboard/basic-chat/sections/ChatCommandsMenu.tsx`
- Modify: `src/app/(dashboard)/dashboard/basic-chat/sections/ChatComposer.tsx`

**Interfaces:**
- Consumes: `handleExportConversation` (already in `UseSendMessageReturn`, `useSendMessage.ts` line 336), `currentSession`/`updateSession` for the plan-mode toggle (already available in `ChatComposer.tsx`).

- [x] **Step 1: Build the menu component**

Create `src/app/(dashboard)/dashboard/basic-chat/sections/ChatCommandsMenu.tsx`:

```tsx
"use client";

import { Plus, Download, ListTree } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";

interface ChatCommandsMenuProps {
  disabled: boolean;
  onExport: (format: "json" | "markdown") => void;
  onTogglePlanMode: () => void;
  isPlanMode: boolean;
}

const COMING_SOON_COMMANDS = ["compact", "feedback", "goal", "permission"] as const;

/** The "+" command palette, separate from the attach-file button — lists session-level actions. */
export default function ChatCommandsMenu({ disabled, onExport, onTogglePlanMode, isPlanMode }: ChatCommandsMenuProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" type="button" aria-label={translate("Commands") || "Commands"} disabled={disabled} className="size-8 text-muted-foreground hover:text-foreground">
          <Plus className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <button type="button" onClick={() => onExport("markdown")} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted">
          <Download className="size-3.5" />
          {translate("Export session") || "Export session"}
        </button>
        <button type="button" onClick={onTogglePlanMode} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted">
          <ListTree className="size-3.5" />
          {isPlanMode ? (translate("Leave plan mode") || "Leave plan mode") : (translate("Enter plan mode") || "Enter plan mode")}
        </button>
        <div className="my-1 border-t border-border" />
        {COMING_SOON_COMMANDS.map((command) => (
          <div key={command} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-muted-foreground/50 capitalize cursor-not-allowed" title={translate("Coming soon") || "Coming soon"}>
            {command}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
```

- [x] **Step 2: Wire it into `ChatComposer.tsx`, keeping attach separate**

Add the import, and destructure `handleExportConversation` from `sendHook` (line 23). Insert the new menu immediately before the existing Paperclip button (line 79), so the toolbar reads `[+] [paperclip] [model name] ...`:

```tsx
              <ChatCommandsMenu
                disabled={!activeModel || loadingData}
                onExport={handleExportConversation}
                onTogglePlanMode={() => currentSession && updateSession(currentSession.id, (session) => ({ ...session, mode: session.mode === "plan" ? "agent" : "plan" }))}
                isPlanMode={currentSession?.mode === "plan"}
              />
```

- [x] **Step 3: Manually verify in the browser**

Click the new `+` button — confirm the menu opens with Export/Plan-mode as clickable, the 4 "coming soon" items greyed and inert, and the paperclip attach button still works independently right next to it.

- [x] **Step 4: Run lint and typecheck**

Run: `npx eslint "src/app/(dashboard)/dashboard/basic-chat/sections/ChatCommandsMenu.tsx" "src/app/(dashboard)/dashboard/basic-chat/sections/ChatComposer.tsx" && npx tsc --noEmit --pretty false`
Expected: 0 errors.

- [x] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/basic-chat/sections/ChatCommandsMenu.tsx src/app/\(dashboard\)/dashboard/basic-chat/sections/ChatComposer.tsx
git commit -m "feat: add a separate '+' commands menu next to the attach button"
```

---

## Phase 5: Context-used indicator

Reference: a button near the composer showing `1% of context used  ~8.7K / 1M` with a breakdown (System prompt / Tools / Messages) on click. This codebase has no client-side tokenizer, so this is an estimate using the same `chars / 4` heuristic already used server-side for a similar purpose (`src/server/llm-gateway/engine/executors/aihorde.ts:31-44`, `estimateTokens`) — consistent precedent for "good enough" client-facing token estimates in this codebase.

### Task 5.1: Estimate and display context usage

**Files:**
- Create: `src/app/(dashboard)/dashboard/basic-chat/sections/contextUsageEstimate.ts`
- Modify: `src/app/(dashboard)/dashboard/basic-chat/sections/ChatComposer.tsx`
- Test: `tests/unit/contextUsageEstimate.test.ts`

**Interfaces:**
- Consumes: `ChatSession["messages"]`, the session's system prompt string, the resolved runtime-tools JSON (from `@/shared/harness/agentPlugins`'s `getRuntimeToolDefinitions`).
- Produces: `estimateContextUsage(messages, systemPrompt, toolsJson, contextWindowTokens?): ContextUsageEstimate`.

- [x] **Step 1: Write the estimator with its test first**

Create `src/app/(dashboard)/dashboard/basic-chat/sections/contextUsageEstimate.ts`:

```ts
import type { ChatMessage } from "../types";

const CHARS_PER_TOKEN = 4;
/** Used when the model's real context window isn't known client-side. Conservative floor shared by most current-generation chat models. */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;

export interface ContextUsageEstimate {
  systemPromptTokens: number;
  toolsTokens: number;
  messagesTokens: number;
  totalTokens: number;
  contextWindowTokens: number;
  percentUsed: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Rough (chars/4) client-side estimate of context usage — no real tokenizer is available in the browser. */
export function estimateContextUsage(
  messages: ChatMessage[],
  systemPrompt: string,
  toolsJson: string,
  contextWindowTokens: number = DEFAULT_CONTEXT_WINDOW_TOKENS,
): ContextUsageEstimate {
  const systemPromptTokens = estimateTokens(systemPrompt);
  const toolsTokens = estimateTokens(toolsJson);
  const messagesTokens = messages.reduce((sum, m) => sum + estimateTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")), 0);
  const totalTokens = systemPromptTokens + toolsTokens + messagesTokens;
  return {
    systemPromptTokens,
    toolsTokens,
    messagesTokens,
    totalTokens,
    contextWindowTokens,
    percentUsed: contextWindowTokens > 0 ? (totalTokens / contextWindowTokens) * 100 : 0,
  };
}
```

- [x] **Step 2: Write the test**

Create `tests/unit/contextUsageEstimate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimateContextUsage } from "@/app/(dashboard)/dashboard/basic-chat/sections/contextUsageEstimate";

describe("estimateContextUsage", () => {
  it("sums system prompt, tools, and message tokens using a 4-chars-per-token heuristic", () => {
    const result = estimateContextUsage(
      [{ id: "u1", role: "user", content: "a".repeat(400) }],
      "b".repeat(200),
      "c".repeat(800),
      100_000,
    );
    expect(result).toEqual({ systemPromptTokens: 50, toolsTokens: 200, messagesTokens: 100, totalTokens: 350, contextWindowTokens: 100_000, percentUsed: 0.35 });
  });

  it("defaults to the shared context-window constant when none is given", () => {
    const result = estimateContextUsage([], "", "");
    expect(result.contextWindowTokens).toBe(128_000);
  });
});
```

- [x] **Step 3: Run the test**

Run: `npx vitest run tests/unit/contextUsageEstimate.test.ts`
Expected: PASS.

- [x] **Step 4: Display it in the composer**

In `ChatComposer.tsx`, import `estimateContextUsage` and `getRuntimeToolDefinitions` from `@/shared/harness/agentPlugins`, plus `Popover`/`PopoverContent`/`PopoverTrigger` (already imported by Task 3.2 if that landed first — dedupe the import). Ensure `systemPrompt` is destructured from `sessionsHook` (add it to the existing destructuring at line 20-22 if not already present). Compute the estimate right before the `return` statement:

```ts
  const contextUsage = estimateContextUsage(
    currentSession?.messages ?? [],
    systemPrompt,
    JSON.stringify(getRuntimeToolDefinitions(currentSession?.agentPresetId, currentSession?.pluginOverrides)),
  );
```

Add a small button+popover next to the model name (inside the same toolbar row, e.g. right after the Effort popover from Task 3.2):

```tsx
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                    {contextUsage.percentUsed < 1 ? "<1" : contextUsage.percentUsed.toFixed(0)}% {translate("of context used") || "of context used"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64" align="start">
                  <p className="mb-2 text-xs font-medium">{contextUsage.percentUsed.toFixed(0)}% {translate("of context used") || "of context used"} — ~{(contextUsage.totalTokens / 1000).toFixed(1)}K / {(contextUsage.contextWindowTokens / 1000).toFixed(0)}K</p>
                  <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, contextUsage.percentUsed)}%` }} />
                  </div>
                  <dl className="space-y-1 text-[11px]">
                    <div className="flex justify-between"><dt className="text-muted-foreground">{translate("System prompt") || "System prompt"}</dt><dd>~{(contextUsage.systemPromptTokens / 1000).toFixed(1)}K</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">{translate("Tools") || "Tools"}</dt><dd>~{(contextUsage.toolsTokens / 1000).toFixed(1)}K</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">{translate("Messages") || "Messages"}</dt><dd>~{(contextUsage.messagesTokens / 1000).toFixed(1)}K</dd></div>
                  </dl>
                </PopoverContent>
              </Popover>
```

- [x] **Step 5: Manually verify in the browser**

Confirm the percentage badge appears, updates as messages are sent, and the popover breakdown adds up to the total shown in the header line.

- [x] **Step 6: Run lint and typecheck**

Run: `npx eslint "src/app/(dashboard)/dashboard/basic-chat/sections/ChatComposer.tsx" "src/app/(dashboard)/dashboard/basic-chat/sections/contextUsageEstimate.ts" && npx tsc --noEmit --pretty false`
Expected: 0 errors.

- [x] **Step 7: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/basic-chat/sections/contextUsageEstimate.ts src/app/\(dashboard\)/dashboard/basic-chat/sections/ChatComposer.tsx tests/unit/contextUsageEstimate.test.ts
git commit -m "feat: add estimated context-usage indicator to the composer"
```

---

## Phase 6: Collapsible search (and the same pattern for project/folder creation)

Today `ChatSidebar.tsx:236-246` always renders an open search `<Input>`; `145-154` toggles project creation via a boolean already (`isCreatingProject`), just not with a lupa→X icon-swap affordance. This phase converts search to the icon-toggle pattern and makes project creation visually consistent with it.

### Task 6.1: Collapsible search bar

**Files:**
- Modify: `src/app/(dashboard)/dashboard/basic-chat/sections/ChatSidebar.tsx`

**Interfaces:**
- Consumes: `historySearch`/`setHistorySearch` (already in `useChatSessions.ts`'s return, used today at `ChatSidebar.tsx:236-246`).

- [x] **Step 1: Add local open/close state and the icon-toggle behavior**

In `ChatSidebar.tsx`, add local state near the top of the component:

```ts
const [isSearchOpen, setIsSearchOpen] = useState(false);
```

Replace the always-visible input block (lines 236-246) with a toggle:

```tsx
{isSearchOpen ? (
  <div className="flex items-center gap-1.5 px-1">
    <Input
      autoFocus
      value={historySearch}
      onChange={(e) => setHistorySearch(e.target.value)}
      placeholder={translate("Search sessions...") || "Search sessions..."}
      className="h-8 flex-1 text-xs"
    />
    <button
      type="button"
      aria-label={translate("Close search") || "Close search"}
      onClick={() => { setIsSearchOpen(false); setHistorySearch(""); }}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <X className="size-3.5" />
    </button>
  </div>
) : (
  <button
    type="button"
    aria-label={translate("Search sessions") || "Search sessions"}
    onClick={() => setIsSearchOpen(true)}
    className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground hover:text-foreground"
  >
    <Search className="size-3.5" />
    {translate("Search") || "Search"}
  </button>
)}
```

(`Search` is already imported per the earlier grep; add `X` to the same `lucide-react` import line if not already present — `ChatComposer.tsx` already imports `X` from `lucide-react`; confirm `ChatSidebar.tsx`'s import list and add it if missing.)

- [x] **Step 2: Apply the same icon-toggle chrome to "create project"**

The existing `isCreatingProject` boolean (line 145-154) already collapses/expands a form — this step only needs to change its *trigger* to match the new visual language (icon that becomes an X while open), if it doesn't already. Read the current trigger button at `ChatSidebar.tsx:145-147` before editing: if it's a static `Plus` icon that stays a `Plus` while `isCreatingProject` is true, change it to render `X` instead of `Plus` when `isCreatingProject` is true, mirroring Step 1's pattern:

```tsx
<button type="button" onClick={() => setIsCreatingProject((open) => !open)} aria-label={isCreatingProject ? (translate("Cancel") || "Cancel") : (translate("Create project") || "Create project")}>
  {isCreatingProject ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
</button>
```

- [x] **Step 3: Manually verify in the browser**

Confirm search starts closed (just a "Search" affordance), clicking it opens the input with focus, clicking X closes it and clears the query. Confirm the project-creation toggle now shows X while its form is open.

- [x] **Step 4: Run lint and typecheck**

Run: `npx eslint "src/app/(dashboard)/dashboard/basic-chat/sections/ChatSidebar.tsx" && npx tsc --noEmit --pretty false`
Expected: 0 errors.

- [x] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/basic-chat/sections/ChatSidebar.tsx
git commit -m "feat: make session search and project creation collapsible icon toggles"
```

---

## Phase 7: Richer Trajectory view

This is the largest, most visual phase. The existing `ChatRunJournal.tsx` + `useHarnessEvents.ts` + `runJournalHelpers.ts` already has a colored-dot timeline and expandable JSON per event — this phase adds the missing **event-type taxonomy** (SYSTEM / CONTEXT / USER / ASSISTANT, matching the reference) and a **readable per-turn content list** instead of raw JSON dumps. Full pixel-for-pixel parity with the reference's multi-row colored duration bar (Input/Model/Tools stacked segments) is flagged at the end of this phase as a follow-up — this plan lands the data model and a first working visual, not a final polish pass.

### Task 7.1: Add an event-type classifier

**Files:**
- Modify: `src/app/(dashboard)/dashboard/basic-chat/runJournalHelpers.ts`
- Test: `tests/unit/runJournalHelpers.test.ts` (extend or create)

**Interfaces:**
- Consumes: `HarnessEvent` (`types.ts:69-75`, already has `type: string`).
- Produces: `classifyEventKind(event: HarnessEvent): "system" | "context" | "user" | "assistant" | "tool"`.

- [x] **Step 1: Confirm the exact event `type` strings already emitted**

Run: `grep -n "recordHarnessEvent(" "src/app/(dashboard)/dashboard/basic-chat/hooks/useSendMessage.ts"`
Expected output includes exactly these event-type strings: `"user/message"`, `"run/start"`, `"assistant/reasoning"`, `"assistant/message"`, `"tool/call"`, `"tool/result"`, `"run/complete"`, `"run/end"` — use exactly these when writing the classifier below (do not invent new event names).

- [x] **Step 2: Write the test**

Add to `tests/unit/runJournalHelpers.test.ts` (create following the sibling test-file pattern if it doesn't exist yet):

```ts
import { describe, expect, it } from "vitest";
import { classifyEventKind } from "@/app/(dashboard)/dashboard/basic-chat/runJournalHelpers";
import type { HarnessEvent } from "@/app/(dashboard)/dashboard/basic-chat/types";

const event = (type: string): HarnessEvent => ({ sessionId: "s1", seq: 1, type, data: {}, createdAt: new Date().toISOString() });

describe("classifyEventKind", () => {
  it("classifies user/message as user", () => { expect(classifyEventKind(event("user/message"))).toBe("user"); });
  it("classifies assistant/message and assistant/reasoning as assistant", () => {
    expect(classifyEventKind(event("assistant/message"))).toBe("assistant");
    expect(classifyEventKind(event("assistant/reasoning"))).toBe("assistant");
  });
  it("classifies run/start and run/end as system", () => {
    expect(classifyEventKind(event("run/start"))).toBe("system");
    expect(classifyEventKind(event("run/end"))).toBe("system");
  });
  it("classifies tool/call and tool/result as tool", () => {
    expect(classifyEventKind(event("tool/call"))).toBe("tool");
    expect(classifyEventKind(event("tool/result"))).toBe("tool");
  });
  it("falls back to context for anything unrecognized", () => { expect(classifyEventKind(event("unknown/thing"))).toBe("context"); });
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/unit/runJournalHelpers.test.ts`
Expected: FAIL (`classifyEventKind` not exported yet).

- [x] **Step 4: Implement**

In `runJournalHelpers.ts`, add:

```ts
import type { HarnessEvent } from "./types";

export type EventKind = "system" | "context" | "user" | "assistant" | "tool";

/** Buckets a raw harness event type string into the Trajectory tab's taxonomy. */
export function classifyEventKind(event: HarnessEvent): EventKind {
  if (event.type.startsWith("user/")) return "user";
  if (event.type.startsWith("assistant/")) return "assistant";
  if (event.type.startsWith("tool/")) return "tool";
  if (event.type.startsWith("run/")) return "system";
  return "context";
}
```

- [x] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/runJournalHelpers.test.ts`
Expected: PASS (5 tests).

- [x] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/basic-chat/runJournalHelpers.ts tests/unit/runJournalHelpers.test.ts
git commit -m "feat: classify harness events into a system/context/user/assistant/tool taxonomy"
```

### Task 7.2: Render the Trajectory tab as a labeled event list

**Files:**
- Modify: `src/app/(dashboard)/dashboard/basic-chat/sections/ChatRunJournal.tsx`

**Interfaces:**
- Consumes: `classifyEventKind` (Task 7.1), existing `harnessEvents` from `useHarnessEvents.ts` (unchanged).

- [x] **Step 1: Read the current file in full before editing**

Open `src/app/(dashboard)/dashboard/basic-chat/sections/ChatRunJournal.tsx` in the editor. This plan doesn't reproduce its current ~121 lines here since editing in place is more reliable than a from-scratch rewrite; the next two steps describe the change relative to what's there.

- [x] **Step 2: Add a per-event label chip using the taxonomy**

Wherever the file renders one event row (the colored dot + `eventColorClass`), add a small uppercase label chip next to the dot showing the event's kind, styled as a `Badge` (already imported project-wide from `@/components/ui/badge` — confirm the import exists in this file and add it if not):

```tsx
<Badge variant="outline" className="text-[9px] px-1.5 py-0 uppercase tracking-wide">
  {classifyEventKind(event)}
</Badge>
```

Place it immediately before or after the existing colored dot, in the same row, without removing the dot (the dot stays as the fine-grained per-event-type color, the badge adds the coarse taxonomy label from the reference). Import `classifyEventKind` from `../runJournalHelpers` at the top of the file.

- [x] **Step 3: Replace the raw-JSON expandable body with readable content for the common cases**

Where the current file dumps `JSON.stringify(event.data)` in the expandable row body, add a helper and use it instead:

```tsx
function renderEventContent(event: HarnessEvent): string {
  const data = event.data as Record<string, unknown>;
  if (event.type === "user/message" || event.type === "assistant/message") {
    return typeof data.content === "string" ? data.content : JSON.stringify(data);
  }
  if (event.type === "tool/call") {
    return `${data.name ?? "tool"}(${typeof data.arguments === "string" ? data.arguments : JSON.stringify(data.arguments)})`;
  }
  if (event.type === "tool/result") {
    return typeof data.content === "string" ? data.content.slice(0, 500) : JSON.stringify(data);
  }
  return JSON.stringify(data);
}
```

Use `renderEventContent(event)` in place of the raw `JSON.stringify(event.data)` call in the row body.

- [x] **Step 4: Manually verify in the browser**

Open the Trajectory/Run Journal panel after a conversation with at least one tool call — confirm each row now shows a taxonomy badge, and `user/message`/`assistant/message`/`tool/call`/`tool/result` rows show readable text instead of raw JSON (other event types still fall back to JSON, which is fine).

- [x] **Step 5: Run lint and typecheck**

Run: `npx eslint "src/app/(dashboard)/dashboard/basic-chat/sections/ChatRunJournal.tsx" && npx tsc --noEmit --pretty false`
Expected: 0 errors.

- [x] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/basic-chat/sections/ChatRunJournal.tsx
git commit -m "feat: label Trajectory events by kind and render common event types readably"
```

**Follow-up flagged, not in this plan:** the reference's stacked multi-color duration bar (separate Input/Model/Tools segments proportional to time spent in each phase) needs per-phase timing the harness events don't currently carry (`run/start` → first-tool-call → tool-result → `run/end` deltas). That's a second data-model change (recording phase-transition timestamps in `useSendMessage.ts`, similar to Task 1.2's TTFT capture) plus a new stacked-bar component — worth its own follow-up plan once Phase 1's timing instrumentation is live and validated, since it would reuse the same `requestStartedAt`/`firstTokenAt` capture points.

---

## Self-Review Notes

- **Spec coverage:** every item from the user's screenshot walkthrough maps to a phase: compact stats bar → Phase 1; last-message usage detail → Phase 2; effort selector → Phase 3; "+" menu separate from attach → Phase 4; context-used button → Phase 5; collapsible search (+ same pattern for folder creation) → Phase 6; richer Trajectory → Phase 7. The plugin-core opencode swap → Phase 0.
- **Placeholder scan:** no TBD/TODO left; the one deliberately-deferred item (Phase 7's stacked duration bar) is called out explicitly as out-of-scope-for-this-plan with a concrete reason (missing phase-timing data), not a vague "later."
- **Type consistency:** `MessageTiming`/`timing` (Task 1.1) is the same shape used in Tasks 1.2, 1.3, 2.1, and referenced (not yet consumed) in Phase 7's follow-up note. `computeUsageBarStats`/`estimateContextUsage`/`classifyEventKind` signatures are each defined once and only referenced afterward, never redefined differently.
- **Scope:** 8 phases is a lot for one document, but each phase touches a disjoint set of files and can be executed, tested, and committed independently — Phase 0 has zero UI overlap with Phases 1-7, and Phases 1-7 only share `types.ts` (additive changes only, no conflicting edits to the same lines across phases).
