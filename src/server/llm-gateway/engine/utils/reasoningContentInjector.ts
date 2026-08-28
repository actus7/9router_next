// Some thinking-mode providers (DeepSeek, Kimi, MiniMax, ...) require reasoning_content
// to be echoed back on assistant messages. Clients in OpenAI format don't send it,
// so we inject a non-empty placeholder to satisfy upstream validation.
import { PROVIDERS } from "../config/providers";

const PLACEHOLDER = " ";

// Provider-level rules derive from registry transport.reasoningInject (single source)
const providerRuleFor = (provider: string) => (PROVIDERS as Record<string, Record<string, unknown>>)[provider]?.reasoningInject as { scope: string } | undefined;

// Model-level rules: matched by predicate against model id
const MODEL_RULES: Array<{ match: (m: string) => boolean; scope: string }> = [
  { match: (m: string) => /^kimi-/i.test(m || ""), scope: "toolCalls" },
  { match: (m: string) => /deepseek/i.test(m || ""), scope: "all" }
];

const DEEPSEEK_V4_PRO = "deepseek-v4-pro";
const DEEPSEEK_V4_PRO_ALIASES = {
  [`${DEEPSEEK_V4_PRO}-max`]: {
    thinkingType: "enabled",
    reasoningEffort: "max"
  },
  [`${DEEPSEEK_V4_PRO}-none`]: {
    thinkingType: "disabled",
    reasoningEffort: null
  }
};

function shouldInject(message: Record<string, unknown>, scope: string): boolean {
  if (message?.role !== "assistant") return false;
  const rc = message.reasoning_content;
  if (typeof rc === "string" && rc.length > 0) return false;
  if (scope === "toolCalls") return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return true;
}

function applyRule(body: Record<string, unknown>, rule: { scope: string } | undefined): Record<string, unknown> {
  if (!rule || !body?.messages) return body;
  const messages = (body.messages as Record<string, unknown>[]).map((m: Record<string, unknown>) =>
    shouldInject(m, rule.scope) ? { ...m, reasoning_content: PLACEHOLDER } : m
  );
  return { ...body, messages };
}

function applyDeepSeekV4ProAlias({ provider, model, body }: { provider: string; model: string; body: Record<string, unknown> }): Record<string, unknown> {
  const alias = DEEPSEEK_V4_PRO_ALIASES[model as keyof typeof DEEPSEEK_V4_PRO_ALIASES];
  if (provider !== "deepseek" || !alias || !body) return body;

  const nextBody: Record<string, unknown> = {
    ...body,
    model: DEEPSEEK_V4_PRO,
    extra_body: {
      ...((body.extra_body as Record<string, unknown>) || {}),
      thinking: {
        ...(((body.extra_body as Record<string, unknown>)?.thinking as Record<string, unknown>) || {}),
        type: alias.thinkingType
      }
    }
  };

  if (alias.reasoningEffort) {
    nextBody.reasoning_effort = alias.reasoningEffort;
  } else {
    delete nextBody.reasoning_effort;
  }

  return nextBody;
}

export function injectReasoningContent({ provider, model, body }: { provider: string; model: string; body: Record<string, unknown> }) {
  const providerRule = providerRuleFor(provider);
  const modelRule = MODEL_RULES.find(r => r.match(model));
  const rule = providerRule || modelRule;
  const nextBody = applyDeepSeekV4ProAlias({ provider, model, body });
  return applyRule(nextBody, rule);
}
