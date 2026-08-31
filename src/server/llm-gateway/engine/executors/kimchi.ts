import { DefaultExecutor } from "./default";
import { getCachedKimchiModelMetadata } from "../services/kimchiModels";
import type { Credentials } from "../services/types";

const TOP_LEVEL_OPENAI_GATEWAY_DROPS = [
  "anthropic_version",
  "anthropic_beta",
  "client_metadata",
  "mcp_servers",
  "stop_sequences",
  "thinking",
  "top_k",
];

function systemToText(system: unknown): string {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") return (part as Record<string, unknown>).text as string;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function mergeTopLevelSystem(body: Record<string, unknown>): void {
  if (!body?.system || !Array.isArray(body.messages)) return;
  const text = systemToText(body.system).trim();
  if (!text) return;

  const existing = (body.messages as Record<string, unknown>[]).find((msg: Record<string, unknown>) => msg?.role === "system");
  if (!existing) {
    (body.messages as Record<string, unknown>[]).unshift({ role: "system", content: text });
    return;
  }

  if (typeof existing.content === "string") {
    existing.content = `${text}\n\n${existing.content}`;
  } else if (Array.isArray(existing.content)) {
    (existing.content as Record<string, unknown>[]).unshift({ type: "text", text });
  }
}

function stripMessageArtifacts(body: Record<string, unknown>): void {
  if (!Array.isArray(body?.messages)) return;
  for (const msg of body.messages as Record<string, unknown>[]) {
    if (!msg || typeof msg !== "object") continue;
    delete msg.cache_control;
    if (!Array.isArray(msg.content)) continue;
    msg.content = (msg.content as Record<string, unknown>[]).map((part: Record<string, unknown>) => {
      if (!part || typeof part !== "object") return part;
      const { cache_control, signature, ...clean } = part;
      return clean;
    });
  }
}

function stripToolArtifacts(body: Record<string, unknown>): void {
  if (!Array.isArray(body?.tools)) return;
  body.tools = (body.tools as Record<string, unknown>[]).map((tool: Record<string, unknown>) => {
    if (!tool || typeof tool !== "object") return tool;
    const { cache_control, ...clean } = tool;
    return clean;
  });
}

// Strip `reasoning_content` echoed by clients on assistant messages — but
// only when it's a real thinking block. `DefaultExecutor.transformRequest`
// runs `injectReasoningContent` first and may inject a 1-char placeholder
// (" ") for upstream validation; the placeholder is small (no token cost
// worth stripping) and stripping it would re-trigger upstream to complain
// about missing reasoning on the next turn. Threshold matches the
// placeholder length with a safety margin.
const REASONING_PLACEHOLDER_MAX_LEN = 8;

function stripReasoningContent(body: Record<string, unknown>): void {
  if (!Array.isArray(body?.messages)) return;
  for (const msg of body.messages as Record<string, unknown>[]) {
    if (msg && msg.role === "assistant" && typeof msg.reasoning_content === "string"
        && (msg.reasoning_content as string).length > REASONING_PLACEHOLDER_MAX_LEN) {
      delete msg.reasoning_content;
    }
  }
}

function isAnthropicBackedKimchiModel(model: string): boolean {
  const meta = getCachedKimchiModelMetadata(model);
  if (meta?.provider === "anthropic" || meta?.upstreamProvider === "anthropic") return true;
  return /(^|[-_/])(?:claude|anthropic)(?:[-_/]|$)/i.test(String(model || ""));
}

export class KimchiExecutor extends DefaultExecutor {
  constructor() {
    super("kimchi");
  }

  transformRequest(model: string, body: Record<string, unknown>, stream: boolean, credentials: Credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (!transformed || typeof transformed !== "object") return transformed;

    mergeTopLevelSystem(transformed);
    for (const key of TOP_LEVEL_OPENAI_GATEWAY_DROPS) {
      if (transformed[key] !== undefined) delete transformed[key];
    }
    delete transformed.system;

    if (isAnthropicBackedKimchiModel(model)) {
      delete transformed.reasoning_effort;
      delete transformed.reasoning;
      delete transformed.thinking;
    }

    stripMessageArtifacts(transformed);
    stripToolArtifacts(transformed);
    stripReasoningContent(transformed);
    return transformed;
  }
}

export default KimchiExecutor;
