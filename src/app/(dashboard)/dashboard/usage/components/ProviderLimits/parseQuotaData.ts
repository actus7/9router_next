import { getModelsByProviderId } from "@/shared/llm-catalog";
import type { QuotaEntry } from "./quotaTypes";

function pushGenericQuotas(
  normalizedQuotas: QuotaEntry[],
  quotas: Record<string, Record<string, unknown>>,
): void {
  Object.entries(quotas).forEach(([name, quota]) => {
    normalizedQuotas.push({
      name,
      used: (quota.used as number) || 0,
      total: (quota.total as number) || 0,
      resetAt: (quota.resetAt as string) || null,
    });
  });
}

function pushRemainingPercentageQuotas(
  normalizedQuotas: QuotaEntry[],
  quotas: Record<string, Record<string, unknown>>,
): void {
  Object.entries(quotas).forEach(([name, quota]) => {
    normalizedQuotas.push({
      name,
      used: (quota.used as number) || 0,
      total: (quota.total as number) || 0,
      resetAt: (quota.resetAt as string) || null,
      remainingPercentage: quota.remainingPercentage as number | undefined,
    });
  });
}

/**
 * Parse provider-specific quota structures into normalized array.
 */
export function parseQuotaData(provider: string, data: Record<string, unknown>): QuotaEntry[] {
  if (!data || typeof data !== "object") return [];

  const normalizedQuotas: QuotaEntry[] = [];

  try {
    const quotas = data.quotas as Record<string, Record<string, unknown>> | undefined;
    switch (provider.toLowerCase()) {
      case "github":
        if (quotas) pushGenericQuotas(normalizedQuotas, quotas);
        break;

      case "antigravity":
        if (quotas) {
          Object.entries(quotas).forEach(([modelKey, quota]) => {
            normalizedQuotas.push({
              name: (quota.displayName as string) || modelKey,
              modelKey,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              resetAt: (quota.resetAt as string) || null,
              remainingPercentage: quota.remainingPercentage as number | undefined,
            });
          });
        }
        break;

      case "codex":
        if (quotas) {
          Object.entries(quotas).forEach(([quotaType, quota]) => {
            normalizedQuotas.push({
              name: quotaType,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              remaining: quota.remaining as number | undefined,
              resetAt: (quota.resetAt as string) || null,
            });
          });
        }
        break;

      case "kiro":
        if (quotas) pushGenericQuotas(normalizedQuotas, quotas);
        break;

      case "qoder":
        if (quotas) {
          Object.entries(quotas).forEach(([quotaType, quota]) => {
            if (quotaType === "organization" && (!quota || (Number(quota.total) || 0) === 0)) {
              return;
            }
            normalizedQuotas.push({
              name: quotaType === "user" ? "Personal" : quotaType === "organization" ? "Organization" : quotaType,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              unit: quota.unit as string | undefined,
              resetAt: (quota.resetAt as string) || null,
            });
          });
        }
        break;

      case "claude":
        if (data.message) {
          normalizedQuotas.push({
            name: "error",
            used: 0,
            total: 0,
            resetAt: null,
            message: data.message as string,
          });
        } else if (quotas) {
          pushGenericQuotas(normalizedQuotas, quotas);
        }
        break;

      case "vercel-ai-gateway":
      case "grok-cli":
      case "kimi":
      case "deepseek":
      case "ollama":
        if (quotas) pushRemainingPercentageQuotas(normalizedQuotas, quotas);
        break;

      case "codebuddy-cn":
        if (quotas) {
          Object.entries(quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              resetAt: (quota.resetAt as string) || null,
              recurring: quota.recurring !== false,
            });
          });
        }
        break;

      default:
        if (quotas) pushGenericQuotas(normalizedQuotas, quotas);
    }
  } catch (error) {
    console.error(`Error parsing quota data for ${provider}:`, error);
    return [];
  }

  const modelOrder = getModelsByProviderId(provider);
  if (modelOrder.length > 0) {
    const orderMap = new Map(modelOrder.map((m, i) => [(m as { id: string }).id, i]));

    normalizedQuotas.sort((a, b) => {
      const keyA = a.modelKey || a.name;
      const keyB = b.modelKey || b.name;
      const orderA = orderMap.get(keyA) ?? 999;
      const orderB = orderMap.get(keyB) ?? 999;
      return orderA - orderB;
    });
  }

  return normalizedQuotas;
}
