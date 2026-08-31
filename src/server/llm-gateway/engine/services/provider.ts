import { PROVIDERS } from "../config/providers";
import { OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE } from "../providers/shared";
import type { RequestBody, Credentials } from "./types";

const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: OPENAI_COMPAT_BASE,
};

const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";
const ANTHROPIC_COMPATIBLE_DEFAULTS = {
  baseUrl: ANTHROPIC_COMPAT_BASE,
};

function isOpenAICompatible(provider: string) {
  return typeof provider === "string" && provider.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

function isAnthropicCompatible(provider: string) {
  return typeof provider === "string" && provider.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}

// Resolve the API type (chat vs responses) for an openai-compatible node.
// The stored apiType on the connection's providerSpecificData (kept in sync with
// the node on create/update) is authoritative. Falls back to the node ID
// substring for legacy nodes created before apiType was persisted — their IDs
// embed the type: openai-compatible-<chat|responses>-<uuid>.
export function resolveOpenAICompatibleApiType(provider: string, credentials: Credentials | null = null) {
  const stored = credentials?.providerSpecificData?.apiType;
  if (stored === "chat" || stored === "responses") return stored;
  return typeof provider === "string" && provider.includes("responses") ? "responses" : "chat";
}

// Detect request format from body structure
export function detectFormat(body: RequestBody) {
  // OpenAI Responses API: has input (array or string) instead of messages[]
  // The Responses API accepts both input as array and input as a plain string
  if (body.input && (Array.isArray(body.input) || typeof body.input === "string") && !body.messages) {
    return "openai-responses";
  }

  // Antigravity format: Gemini wrapped in body.request
  if (body.request?.contents && body.userAgent === "antigravity") {
    return "antigravity";
  }

  // Gemini format: has contents array
  if (body.contents && Array.isArray(body.contents)) {
    return "gemini";
  }

  // OpenAI-specific indicators (check BEFORE Claude)
  // These fields are OpenAI-specific and never appear in Claude format
  if (
    body.stream_options ||           // OpenAI streaming options
    body.response_format ||           // JSON mode, etc.
    body.logprobs !== undefined ||    // Log probabilities
    body.top_logprobs !== undefined ||
    body.n !== undefined ||           // Number of completions
    body.presence_penalty !== undefined ||  // Penalties
    body.frequency_penalty !== undefined ||
    body.logit_bias ||                // Token biasing
    body.user                         // User identifier
  ) {
    return "openai";
  }

  // Claude format: messages with content as array of objects with type
  // Claude requires content to be array with specific structure
  if (body.messages && Array.isArray(body.messages)) {
    const firstMsg = body.messages[0];
    
    // If content is array, check if it follows Claude structure
    if (firstMsg?.content && Array.isArray(firstMsg.content)) {
      const firstContent = firstMsg.content[0];
      
      // Claude format has specific types: text, image, tool_use, tool_result
      // OpenAI multimodal has: text, image_url (note the difference)
      if (firstContent?.type === "text" && !body.model?.includes("/")) {
        // Could be Claude or OpenAI multimodal
        // Check for Claude-specific fields
        if (body.system || body.anthropic_version) {
          return "claude";
        }
        // Check if image format is Claude (source.type) vs OpenAI (image_url.url)
        const hasClaudeImage = (firstMsg.content as Record<string, unknown>[]).some((c: Record<string, unknown>) => 
          c.type === "image" && (c.source as Record<string, unknown>)?.type === "base64"
        );
        const hasOpenAIImage = (firstMsg.content as Record<string, unknown>[]).some((c: Record<string, unknown>) => 
          c.type === "image_url" && (c.image_url as Record<string, unknown>)?.url
        );
        if (hasClaudeImage) return "claude";
        if (hasOpenAIImage) return "openai";
        
        // If still unclear, check for tool format
        const hasClaudeTool = (firstMsg.content as Record<string, unknown>[]).some((c: Record<string, unknown>) => 
          c.type === "tool_use" || c.type === "tool_result"
        );
        if (hasClaudeTool) return "claude";
      }
    }
    
    // If content is string, it's likely OpenAI (Claude also supports this)
    // Check for other Claude-specific indicators
    if (body.system !== undefined || body.anthropic_version) {
      return "claude";
    }
  }

  // Default to OpenAI format
  return "openai";
}

// Get provider config (internal — no external runtime consumer)
function getProviderConfig(provider: string, credentials: Credentials | null = null) {
  if (isOpenAICompatible(provider)) {
    const apiType = resolveOpenAICompatibleApiType(provider, credentials);
    return {
      ...PROVIDERS.openai,
      format: apiType === "responses" ? "openai-responses" : "openai",
      baseUrl: OPENAI_COMPATIBLE_DEFAULTS.baseUrl,
    };
  }
  if (isAnthropicCompatible(provider)) {
    return {
      ...PROVIDERS.anthropic, // Use Anthropic defaults (header: x-api-key)
      format: "claude",
      baseUrl: ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl,
    };
  }
  return PROVIDERS[provider] || PROVIDERS.openai;
}

// Get target format for provider
export function getTargetFormat(provider: string, credentials: Credentials | null = null) {
  if (isOpenAICompatible(provider)) {
    return resolveOpenAICompatibleApiType(provider, credentials) === "responses" ? "openai-responses" : "openai";
  }
  if (isAnthropicCompatible(provider)) {
    return "claude";
  }
  const config = getProviderConfig(provider, credentials);
  return config.format || "openai";
}

// Resolve which transport to use for a provider given the client sourceFormat.
// Multi-endpoint providers (transport.transports[]) pick the entry matching sourceFormat
// to avoid lossy translation; falls back to the default transport when no match.
export function resolveTransport(provider: string, sourceFormat: string) {
  const config = PROVIDERS[provider];
  const transports = config?.transports;
  if (!Array.isArray(transports) || !transports.length) return null;
  return transports.find(t => t.format === sourceFormat) || null;
}

// Check if last message is from user
function isLastMessageFromUser(body: RequestBody) {
  const messages = body.messages || body.contents;
  if (!messages?.length) return true;
  const lastMsg = messages[messages.length - 1];
  return lastMsg?.role === "user";
}

// Check if request has thinking config
function hasThinkingConfig(body: RequestBody) {
  return !!(body.reasoning_effort || body.thinking?.type === "enabled");
}

// Normalize provider-native thinking config based on last message role.
// OpenAI reasoning_effort is request-level and must survive tool-result turns.
export function normalizeThinkingConfig(body: RequestBody) {
  if (!isLastMessageFromUser(body)) {
    delete body.thinking;
  }
  return body;
}
