// Claude helper functions for translator
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../config/defaultThinkingSignature";
import { ROLE, CLAUDE_BLOCK } from "../schema/index";
import { applyCloaking } from "../../utils/claudeCloaking";
import { resolveSessionId } from "../../utils/sessionManager";
import { isValidClaudeSignature } from "../../utils/claudeSignature";
import { PROVIDERS } from "../../providers/index";
import { getCapabilitiesForModel } from "../../providers/capabilities";
import { DEFAULT_MAX_TOKENS } from "../../config/runtimeConfig";

const CACHE_CONTROL_5M = { type: "ephemeral" };
const CACHE_CONTROL_1H = { type: "ephemeral", ttl: "1h" };

// A block type outside this list makes the whole message count as empty and be dropped, so
// anything the caller can legitimately send alone must be listed. container_upload (Files
// API) is one of those: a user turn whose only block is a file reference is valid Anthropic
// input, and dropping it forwarded `messages: []` to the provider.
const CONTENTFUL_BLOCKS: ReadonlySet<string> = new Set([
  CLAUDE_BLOCK.TOOL_USE,
  CLAUDE_BLOCK.TOOL_RESULT,
  CLAUDE_BLOCK.IMAGE,
  CLAUDE_BLOCK.DOCUMENT,
  CLAUDE_BLOCK.CONTAINER_UPLOAD,
]);

function isContentfulBlock(block: Record<string, unknown> | null | undefined): boolean {
  if (!block) return false;
  if (block.type === CLAUDE_BLOCK.TEXT) return !!(block.text as string)?.trim();
  return CONTENTFUL_BLOCKS.has(block.type as string);
}

// Check if message has valid non-empty content
function hasValidContent(msg: Record<string, unknown>) {
  if (typeof msg.content === "string" && msg.content.trim()) return true;
  if (msg.content && typeof msg.content === "object" && !Array.isArray(msg.content)) {
    return isContentfulBlock(msg.content as Record<string, unknown>);
  }
  if (Array.isArray(msg.content)) return (msg.content as Record<string, unknown>[]).some(isContentfulBlock);
  return false;
}

// Fix tool_use/tool_result ordering for Claude API
// 1. Assistant message with tool_use: remove text AFTER tool_use (Claude doesn't allow)
// 2. Merge consecutive same-role messages
function fixToolUseOrdering(messages: Record<string, unknown>[]) {
  if (messages.length <= 1) return messages;

  // Pass 1: Fix assistant messages with tool_use - remove text after tool_use
  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
      const hasToolUse = msg.content.some(b => b.type === CLAUDE_BLOCK.TOOL_USE);
      if (hasToolUse) {
        // Keep only: thinking blocks + tool_use blocks (remove text blocks after tool_use)
        const newContent = [];
        let foundToolUse = false;

        for (const block of msg.content) {
          if (block.type === CLAUDE_BLOCK.TOOL_USE) {
            foundToolUse = true;
            newContent.push(block);
          } else if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
            newContent.push(block);
          } else if (!foundToolUse) {
            // Keep text blocks BEFORE tool_use
            newContent.push(block);
          }
          // Skip text blocks AFTER tool_use
        }

        msg.content = newContent;
      }
    }
  }

  // Pass 2: Merge consecutive same-role messages
  const merged = [];

  for (const msg of messages) {
    const last = merged[merged.length - 1];

    if (last && last.role === msg.role) {
      // Merge content arrays
      const lastContent = Array.isArray(last.content) ? last.content : [{ type: CLAUDE_BLOCK.TEXT, text: last.content }];
      const msgContent = Array.isArray(msg.content) ? msg.content : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];

      // Put tool_result first, then other content
      const toolResults = [...lastContent.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT)];
      const otherContent = [...lastContent.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT)];

      last.content = [...toolResults, ...otherContent];
    } else {
      // Ensure content is array
      const content = Array.isArray(msg.content) ? msg.content : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];
      merged.push({ role: msg.role, content: [...content] });
    }
  }

  return merged;
}

// Models that reject thinking.type "adaptive" + output_config.effort (Opus 4.5+/Sonnet 4.6+ only)
const ADAPTIVE_THINKING_UNSUPPORTED = /haiku/i;

function handlesThinkingBlocks(provider: string | null) {
  return provider === "claude" || provider?.startsWith("anthropic-compatible") || provider === "deepseek";
}

function buildThinkingPlaceholder(provider: string | null) {
  const block: Record<string, unknown> = {
    type: CLAUDE_BLOCK.THINKING,
    thinking: ".",
  };

  // DeepSeek's Anthropic-compatible endpoint requires a thinking block in
  // thinking mode, but it does not need Anthropic's signed-thinking fallback.
  if (provider !== "deepseek") {
    block.signature = DEFAULT_THINKING_CLAUDE_SIGNATURE;
  }

  return block;
}

// Normalize a native Claude passthrough body to match Anthropic Messages API spec.
// Newer Cowork/Claude Code clients emit beta-only shapes that OAuth endpoints reject:
// 1. thinking.type "adaptive" → unsupported on Haiku
// 2. output_config.effort → unsupported on Haiku
// 3. role "system" messages (mid-conversation-system beta) → only top-level system is allowed
export function normalizeClaudePassthrough(body: Record<string, unknown>, model: string = "") {
  if (!body || typeof body !== "object") return body;

  // 1. Downgrade adaptive thinking for models that don't support it
  if ((body.thinking as Record<string, unknown>)?.type === "adaptive" && ADAPTIVE_THINKING_UNSUPPORTED.test(model)) {
    body.thinking = { type: "enabled", budget_tokens: 10000 };
  }

  // 2. Strip effort param for models that don't support it (keep other output_config fields)
  if (ADAPTIVE_THINKING_UNSUPPORTED.test(model) && (body.output_config as Record<string, unknown>)?.effort != null) {
    delete (body.output_config as Record<string, unknown>).effort;
    if (Object.keys(body.output_config as Record<string, unknown>).length === 0) delete body.output_config;
  }

  const originalLastRole = Array.isArray(body.messages)
    ? ((body.messages as Record<string, unknown>[])[body.messages.length - 1]?.role as string | undefined)
    : undefined;

  // 2. Fold mid-conversation system messages into the neighbouring turn.
  // Hoisting them into body.system would insert volatile content (token counters,
  // reminders) ahead of the whole conversation and invalidate the prefix cache on
  // every request. Folding in place keeps the cached prefix stable.
  if (Array.isArray(body.messages)) {
    const messages: Record<string, unknown>[] = [];
    for (const msg of body.messages as Record<string, unknown>[]) {
      if (msg.role !== ROLE.SYSTEM) {
        messages.push(msg);
        continue;
      }
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? (msg.content as (string | Record<string, unknown>)[]).map((b) => (typeof b === "string" ? b : (b as Record<string, unknown>)?.text || "")).join("\n")
          : "";
      if (!text.trim()) continue;

      // Copy-on-write: the caller's body is reused across account-fallback
      // attempts, so folding must never mutate the original message.
      const block: Record<string, unknown> = { type: CLAUDE_BLOCK.TEXT, text };
      const prev: Record<string, unknown> | undefined = messages[messages.length - 1];
      if (prev?.role === ROLE.USER) {
        const content = typeof prev.content === "string"
          ? [{ type: CLAUDE_BLOCK.TEXT, text: prev.content }]
          : Array.isArray(prev.content) ? [...prev.content] : [];
        messages[messages.length - 1] = { ...prev, content: [...content, block] };
        continue;
      }
      messages.push({ role: ROLE.USER, content: [block] });
    }
    body.messages = messages;
  }

  // 3. Drop thinking blocks whose signature is not Claude's (combo mixes models,
  // so foreign signatures leak into history and Anthropic rejects them).
  const thinkingEnabled = (body.thinking as Record<string, unknown>)?.type === "enabled";
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role !== ROLE.ASSISTANT || !Array.isArray(msg.content)) continue;
      let hasToolUse = false;
      let hasKeptThinking = false;
      const kept = [];
      for (const block of msg.content) {
        if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
          if (isValidClaudeSignature(block.signature)) {
            hasKeptThinking = true;
            kept.push(block);
          }
          continue;
        }
        if (block.type === CLAUDE_BLOCK.TOOL_USE) hasToolUse = true;
        kept.push(block);
      }
      msg.content = kept;
      if (thinkingEnabled && !hasKeptThinking && hasToolUse) {
        msg.content.unshift(buildThinkingPlaceholder("claude"));
      }
    }
    body.messages = ensureTrailingUserTurn(body.messages as Record<string, unknown>[], originalLastRole);
  }

  return body;
}

// Put a 5m breakpoint on the last cache-eligible block of a message.
// thinking/redacted_thinking blocks do not accept cache_control.
function markLastCacheableBlock(msg: Record<string, unknown>) {
  if (!Array.isArray(msg?.content)) return false;
  for (let i = msg.content.length - 1; i >= 0; i--) {
    const block = msg.content[i];
    if (typeof block !== "object" || block === null) continue;
    if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) continue;
    block.cache_control = { ...CACHE_CONTROL_5M };
    return true;
  }
  return false;
}

// Anthropic allows at most four cache breakpoints per request, across system, tools and messages.
const MAX_CACHE_BREAKPOINTS = 4;

function countCacheControlBlocks(body: Record<string, unknown>): number {
  const carriers: unknown[] = [];
  if (Array.isArray(body.system)) carriers.push(...body.system);
  if (Array.isArray(body.tools)) carriers.push(...body.tools);
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages as Record<string, unknown>[]) {
      if (Array.isArray(msg?.content)) carriers.push(...msg.content);
    }
  }
  return carriers.filter((block) => !!(block as Record<string, unknown> | null)?.cache_control).length;
}

// In an agent's tool loop a request ends with the results of the last assistant turn's tool
// calls, which come after that turn's breakpoint: they are paid at the full input price, and the
// next request (which appends to them) writes them into the cache. When the breakpoint budget
// has room, a 5m breakpoint on that final user turn caches them now so the next request reads them.
function markFinalToolResults(body: Record<string, unknown>): boolean {
  const messages = body?.messages as Record<string, unknown>[] | undefined;
  const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
  if (last?.role !== ROLE.USER || !Array.isArray(last.content)) return false;
  const blocks = last.content as Record<string, unknown>[];
  if (!blocks.some((block) => block?.type === CLAUDE_BLOCK.TOOL_RESULT)) return false;
  if (blocks.some((block) => block?.cache_control)) return false;
  if (countCacheControlBlocks(body) >= MAX_CACHE_BREAKPOINTS) return false;
  return markLastCacheableBlock(last);
}

// Newer Claude models reject a body that ends on an assistant turn ("does not support assistant
// message prefill"). Cleanup passes delete messages left empty, so a trailing user turn that was
// empty (or held only dropped blocks) silently makes the previous assistant turn the last one.
// A user turn is restored only when the client did not itself end on assistant: that is real
// prefill and its own choice.
const TRAILING_USER_PLACEHOLDER = "Continue.";

export function ensureTrailingUserTurn<T extends Record<string, unknown>>(messages: T[], originalLastRole: string | undefined): T[] {
  if (!Array.isArray(messages) || originalLastRole === ROLE.ASSISTANT) return messages;
  if (messages[messages.length - 1]?.role !== ROLE.ASSISTANT) return messages;
  return [...messages, { role: ROLE.USER, content: [{ type: CLAUDE_BLOCK.TEXT, text: TRAILING_USER_PLACEHOLDER }] } as unknown as T];
}

// Re-anchor cache breakpoints on a Claude passthrough body (same policy as
// prepareClaudeRequest): last tool + last system block at 1h, last assistant at 5m.
// The client's own markers point at pre-normalization offsets, so they are dropped.
// Must run LAST, after every step that can reshape system/tools/messages
// (normalize, tool dedupe, token savers) — otherwise the anchor drifts off the tail.
export function anchorClaudeCache(body: Record<string, unknown>) {
  if (!body || typeof body !== "object") return body;

  if (Array.isArray(body.system)) {
    const last = body.system.length - 1;
    body.system.forEach((block, i) => {
      if (typeof block !== "object" || block === null) return;
      if (i === last) block.cache_control = { ...CACHE_CONTROL_1H };
      else delete block.cache_control;
    });
  }

  if (Array.isArray(body.tools)) {
    const last = body.tools.length - 1;
    body.tools.forEach((tool, i) => {
      if (i === last) tool.cache_control = { ...CACHE_CONTROL_1H };
      else delete tool.cache_control;
    });
  }

  if (Array.isArray(body.messages)) {
    let anchored = null;
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const msg = body.messages[i];
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) delete block.cache_control;

      // Prefer the last assistant turn: it ends a completed exchange, so the
      // prefix up to it stays byte-stable across the following requests.
      if (anchored || msg.role !== ROLE.ASSISTANT) continue;
      anchored = markLastCacheableBlock(msg);
    }

    // First turn of a conversation has no assistant yet — anchor the final
    // message instead, so the opening prompt is cached rather than paid twice.
    if (!anchored) {
      for (let i = body.messages.length - 1; i >= 0 && !anchored; i--) {
        anchored = markLastCacheableBlock(body.messages[i]);
      }
    }

    // ...and a tool loop's final tool results, so the next step reads them.
    markFinalToolResults(body);
  }

  return body;
}

// Prepare request for Claude format endpoints
// - Cleanup cache_control
// - Filter empty messages
// - Add thinking block for Anthropic endpoint (provider === "claude")
// - Fix tool_use/tool_result ordering
// - Apply cloaking (billing header + fake user ID) for OAuth tokens
export function prepareClaudeRequest(body: Record<string, unknown>, provider: string | null = null, apiKey: string | null = null, connectionId: string | null = null, rawHeaders: Record<string, unknown> | null = null, sessionId: string | null = null) {
  // quirk: MiniMax's Claude-compatible endpoint rejects Anthropic's output_config (400 invalid params)
  if ((PROVIDERS[provider as string]?.quirks as Record<string, unknown>)?.dropOutputConfig) {
    delete body.output_config;
  }

  // Clamp max_tokens to the model's real output ceiling. Models whose caps
  // declare a higher maxOutput (e.g. Opus 4.8 / Sonnet 4.6 = 128000) are allowed
  // up to it, so max-effort thinking gets full budget; others fall back to the
  // conservative 64000 default.
  if (body.max_tokens) {
    const ceiling = getCapabilitiesForModel(provider as string, body.model as string).maxOutput || DEFAULT_MAX_TOKENS;
    if ((body.max_tokens as number) > ceiling) body.max_tokens = ceiling;

    // Reconcile against thinking budget. applyThinking (thinkingUnified.js) runs
    // AFTER adjustMaxTokens capped max_tokens, and the claude-budget format maps
    // max effort → budget_tokens 128000 — larger than the clamped max_tokens.
    // Anthropic requires max_tokens strictly greater than budget_tokens (else 400).
    // Prefer raising max_tokens to preserve the requested thinking depth; if the
    // budget alone meets/exceeds the ceiling, cap output and shrink the budget so
    // some tokens remain for the answer.
    const thinking = body.thinking as Record<string, unknown> | undefined;
    if (thinking?.type === "enabled" && thinking.budget_tokens && (thinking.budget_tokens as number) >= (body.max_tokens as number)) {
      body.max_tokens = Math.min((thinking.budget_tokens as number) + 1024, ceiling);
      if ((thinking.budget_tokens as number) >= (body.max_tokens as number)) {
        thinking.budget_tokens = Math.max(1024, (body.max_tokens as number) - 1024);
      }
    }
  }

  // 1. System: remove all cache_control, add only to last block with ttl 1h
  if (body.system && Array.isArray(body.system)) {
    body.system = (body.system as Record<string, unknown>[]).map((block: Record<string, unknown>, i: number) => {
      const { cache_control, ...rest } = block;
      if (i === (body.system as unknown[]).length - 1) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });
  }

  // 2. Messages: process in optimized passes
  if (body.messages && Array.isArray(body.messages)) {
    const len = body.messages.length;
    const originalLastRole = (body.messages[len - 1] as Record<string, unknown> | undefined)?.role as string | undefined;
    let filtered = [];

    // Pass 1: remove cache_control + filter empty messages
    for (let i = 0; i < len; i++) {
      const msg = body.messages[i];

      // Remove cache_control from content blocks
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          delete block.cache_control;
        }
      }

      // Keep final assistant even if empty, otherwise check valid content
      const isFinalAssistant = i === len - 1 && msg.role === "assistant";
      if (isFinalAssistant || hasValidContent(msg)) {
        filtered.push(msg);
      }
    }

    // Pass 1.5: Fix tool_use/tool_result ordering
    // Each tool_use must have tool_result in the NEXT message (not same message with other content)
    filtered = fixToolUseOrdering(filtered);
    filtered = ensureTrailingUserTurn(filtered, originalLastRole);

    body.messages = filtered;

    // Check if thinking is enabled AND last message is from user
    const lastMessage = filtered[filtered.length - 1];
    const lastMessageIsUser = lastMessage?.role === "user";
    const thinkingEnabled = (body.thinking as Record<string, unknown>)?.type === "enabled" && lastMessageIsUser;

    // Pass 2 (reverse): add cache_control to last assistant + handle thinking for Anthropic
    let lastAssistantProcessed = false;
    for (let i = filtered.length - 1; i >= 0; i--) {
      const msg = filtered[i];

      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        // Add cache_control to last non-thinking block of first (from end) assistant with content
        // thinking/redacted_thinking blocks do not support cache_control
        if (!lastAssistantProcessed && msg.content.length > 0) {
          for (let j = msg.content.length - 1; j >= 0; j--) {
            const block = msg.content[j];
            if (block.type !== CLAUDE_BLOCK.THINKING && block.type !== CLAUDE_BLOCK.REDACTED_THINKING) {
              block.cache_control = { type: "ephemeral" };
              break;
            }
          }
          lastAssistantProcessed = true;
        }

        // Handle thinking blocks for Anthropic-compatible endpoints.
        if (handlesThinkingBlocks(provider)) {
          let hasToolUse = false;
          let hasKeptThinking = false;

          // Claude native: preserve valid signatures, drop invalid blocks.
          // anthropic-compatible: replace with default (safe fallback for lenient upstreams).
          // DeepSeek: keep existing thinking as-is; add an unsigned placeholder only if missing.
          const isClaudeNative = provider === "claude";
          const isDeepSeek = provider === "deepseek";
          const kept = [];
          for (const block of msg.content) {
            const isThinking = block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING;
            if (isThinking) {
              if (isClaudeNative) {
                if (isValidClaudeSignature(block.signature)) {
                  hasKeptThinking = true;
                  kept.push(block);
                }
              } else if (isDeepSeek) {
                hasKeptThinking = true;
                kept.push(block);
              } else {
                block.signature = DEFAULT_THINKING_CLAUDE_SIGNATURE;
                hasKeptThinking = true;
                kept.push(block);
              }
              continue;
            }
            if (block.type === CLAUDE_BLOCK.TOOL_USE) hasToolUse = true;
            kept.push(block);
          }
          msg.content = kept;

          // Add thinking block if thinking enabled + has tool_use but no thinking
          if (thinkingEnabled && !hasKeptThinking && hasToolUse) {
            (msg.content as unknown[]).unshift(buildThinkingPlaceholder(provider));
          }
        }
      }
    }
  }

  // 3. Tools: filter built-in tools for non-Anthropic providers, then handle cache_control
  if (body.tools && Array.isArray(body.tools)) {
    // Strip built-in tools (e.g. web_search_20250305) and normalize to Anthropic-native shape
    // (drop `type` field, fold `function.{name,description,parameters}`) for non-Anthropic providers
    if (provider !== "claude") {
      body.tools = (body.tools as Record<string, unknown>[])
        .filter((tool: Record<string, unknown>) => !tool.type || tool.type === "function")
        .map((tool: Record<string, unknown>) => {
          if (tool.function) {
            const fn = tool.function as Record<string, unknown>;
            return {
              name: fn.name,
              description: fn.description,
              input_schema: fn.parameters,
            };
          }
          const { type, ...rest } = tool;
          return rest;
        });
    }

    body.tools = (body.tools as Record<string, unknown>[]).map((tool: Record<string, unknown>, i: number) => {
      const { cache_control, ...rest } = tool;
      if (i === (body.tools as unknown[]).length - 1) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });

    // Remove tools array and tool_choice if empty after filtering
    if ((body.tools as unknown[]).length === 0) {
      delete body.tools;
      delete body.tool_choice;
    }
  }

  // A tool loop's final tool results: cached now, so the next step reads them.
  markFinalToolResults(body);

  // Apply cloaking for OAuth tokens (billing header + fake user ID)
  // session_id in user_id must match X-Claude-Code-Session-Id for fingerprint consistency
  if ((provider === "claude" || provider?.startsWith("anthropic-compatible")) && apiKey) {
    const sid = sessionId || resolveSessionId({ headers: rawHeaders, body, connectionId, scope: "claude" });
    body = applyCloaking(body, apiKey, sid);
  }

  return body;
}
