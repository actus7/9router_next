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
  refresh(
    token: string,
    externalServiceId: string,
    externalDeployId: string | null,
  ): Promise<RefreshResult>;
  deleteService(token: string, externalServiceId: string): Promise<"deleted" | "missing">;
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
