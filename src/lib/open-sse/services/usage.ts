/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { getGitHubUsage } from "./usage/github";
import { getGeminiUsage, getAntigravityUsage } from "./usage/google";
import { getClaudeUsage } from "./usage/claude";
import { getCodexUsage, consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits } from "./usage/codex";

export { consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits };
import { getKiroUsage } from "./usage/kiro";
import { getMiniMaxUsage } from "./usage/minimax";
import { getCodeBuddyCnUsage, getCodeBuddyIntlUsage } from "./usage/codebuddy-cn";
import { getGrokCliUsage } from "./usage/grok-cli";
import { getKimiUsage } from "./usage/kimi";
import { getDeepseekUsage } from "./usage/deepseek";
import { resolveQoderCredentials } from "./qoderModels";
import {
  getIflowUsage,
  getOllamaUsage,
  getGlmUsage,
  getVercelAiGatewayUsage,
  getQoderUsage,
} from "./usage/misc";

interface UsageContext {
  provider: string;
  accessToken: string;
  apiKey: string;
  providerSpecificData: Record<string, unknown>;
  providerDataWithProjectId: Record<string, unknown>;
  proxyOptions: unknown;
  force: boolean;
}

interface UsageConnection {
  provider: string;
  accessToken?: string;
  apiKey?: string;
  providerSpecificData?: Record<string, unknown>;
  projectId?: string;
  [key: string]: unknown;
}

interface UsageOptions {
  force?: boolean;
}

// provider → usage handler (ctx carries every arg each handler needs)
const USAGE_HANDLERS: Record<string, (c: UsageContext) => Promise<unknown>> = {
  github: (c: UsageContext) => getGitHubUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  "gemini-cli": (c: UsageContext) => getGeminiUsage(c.accessToken, c.providerDataWithProjectId, c.proxyOptions),
  antigravity: (c: UsageContext) => getAntigravityUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  claude: (c: UsageContext) => getClaudeUsage(c.accessToken, c.proxyOptions, { force: c.force }),
  codex: (c: UsageContext) => getCodexUsage(c.accessToken, c.proxyOptions),
  kiro: (c: UsageContext) => getKiroUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  qoder: async (c: UsageContext) => {
    // PAT (pt-...) connections must be exchanged to a job token before the
    // quota endpoint accepts them.
    const resolved = await resolveQoderCredentials(c, c.proxyOptions).catch(() => null);
    return getQoderUsage(resolved?.accessToken || c.accessToken, c.proxyOptions);
  },
  iflow: (c: UsageContext) => getIflowUsage(c.accessToken),
  ollama: (c: UsageContext) => getOllamaUsage(c.apiKey, c.providerSpecificData, c.proxyOptions),
  glm: (c: UsageContext) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  "glm-cn": (c: UsageContext) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  minimax: (c: UsageContext) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "minimax-cn": (c: UsageContext) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "vercel-ai-gateway": (c: UsageContext) => getVercelAiGatewayUsage(c.apiKey, c.proxyOptions),
  "codebuddy-cn": (c: UsageContext) => getCodeBuddyCnUsage(c.accessToken, c.apiKey, c.providerSpecificData, c.proxyOptions),
  "codebuddy-intl": (c: UsageContext) => getCodeBuddyIntlUsage(c.accessToken, c.apiKey, c.providerSpecificData, c.proxyOptions),
  "grok-cli": (c: UsageContext) => getGrokCliUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  kimi: (c: UsageContext) => getKimiUsage(c.accessToken, c.apiKey, c.proxyOptions, c.providerSpecificData),
  deepseek: (c: UsageContext) => getDeepseekUsage(c.apiKey, c.proxyOptions),
};

export async function getUsageForProvider(connection: UsageConnection, proxyOptions: unknown = null, options: UsageOptions = {}): Promise<unknown> {
  const { provider, accessToken, apiKey, providerSpecificData, projectId } = connection;
  const providerDataWithProjectId: Record<string, unknown> = {
    ...(providerSpecificData || {}),
    ...(projectId ? { projectId } : {}),
  };

  const handler = USAGE_HANDLERS[provider];
  if (!handler) return { message: `Usage API not implemented for ${provider}` };
  return await handler({
    provider,
    accessToken: accessToken ?? "",
    apiKey: apiKey ?? "",
    providerSpecificData: providerSpecificData ?? {},
    providerDataWithProjectId,
    proxyOptions,
    force: options.force === true,
  });
}
