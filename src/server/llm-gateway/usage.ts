// Public server API of the LLM gateway â€” usage tracking & executor access.
import "server-only";
import "@/server/llm-gateway/engine/utils/proxyFetch"; // global fetch patch must load before upstream calls

export { getExecutor } from "@/server/llm-gateway/engine/executors/index";
export { proxyAwareFetch } from "@/server/llm-gateway/engine/utils/proxyFetch";
export {
  getUsageForProvider,
  consumeCodexRateLimitResetCredit,
  getCodexRateLimitResetCredits,
} from "@/server/llm-gateway/engine/services/usage";
export { getClaudeUsage } from "@/server/llm-gateway/engine/services/usage/claude";
export { getCodexUsage } from "@/server/llm-gateway/engine/services/usage/codex";
export { CLAUDE_CLI_SPOOF_HEADERS } from "@/server/llm-gateway/engine/providers/shared";
