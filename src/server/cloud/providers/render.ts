import type { CloudToolManifest, CloudToolEnvInput, CloudToolStartup } from "../tools/types";
import type { CloudProviderDriver, AccountMetadata, DeployResult, UpdateResult, RefreshResult, CloudDeploymentStatus } from "./driver";
import { CloudProviderError, CloudProviderErrorType } from "./driver";

const RENDER_API_BASE = "https://api.render.com/v1";
const RENDER_REGION = "oregon";
const RENDER_PLAN = "free";

class RenderApiError extends Error {
  responseBody: unknown;
  status: number;
  constructor(input: { message: string; responseBody?: unknown; status: number }) {
    super(input.message);
    this.name = "RenderApiError";
    this.responseBody = input.responseBody;
    this.status = input.status;
  }
}

type RenderOwner = { email?: string; id?: string; name?: string };
type RenderServiceDetails = { plan?: string; region?: string; url?: string };
type RenderService = { id?: string; name?: string; serviceDetails?: RenderServiceDetails; suspended?: string };
type RenderDeploy = { id?: string; status?: string };

function extractErrorMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) {
    const msg = (body as { message?: string }).message;
    if (msg) return msg;
  }
  return "Render API request failed";
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function renderRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetch(`${RENDER_API_BASE}${path}`, { ...init, headers });
  if (response.status === 204) return null as T;

  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw new RenderApiError({ message: extractErrorMessage(body), responseBody: body, status: response.status });
  }
  return body as T;
}

function mapRenderDeployStatus(deployStatus: string | undefined, suspended: string | undefined): { error: string | null; status: CloudDeploymentStatus } {
  if (deployStatus === "live") return { error: null, status: "healthy" };
  if (deployStatus === "build_failed" || deployStatus === "update_failed" || deployStatus === "pre_deploy_failed") {
    return { error: "O deploy falhou no Render.", status: "failed" };
  }
  if (deployStatus === "canceled") return { error: "O deploy foi cancelado no Render.", status: "failed" };
  if (deployStatus === "deactivated") {
    if (suspended === "suspended") return { error: null, status: "healthy" };
    return { error: "O serviço foi desativado no Render.", status: "failed" };
  }
  return { error: null, status: "provisioning" };
}

function isRenderFreeTierError(error: unknown): boolean {
  if (!(error instanceof RenderApiError)) return false;
  if (![400, 402, 403, 409, 422].includes(error.status)) return false;
  const text = `${error.message} ${JSON.stringify(error.responseBody ?? "")}`.toLowerCase();
  return ["free", "quota", "limit", "plan", "upgrade", "payment"].some((k) => text.includes(k));
}

async function requireRenderOwner(token: string): Promise<RenderOwner & { id: string }> {
  type OwnerItem = { owner?: RenderOwner };
  const items = await renderRequest<OwnerItem[]>(token, "/owners?limit=1");
  const owner = items?.[0]?.owner;
  if (!owner?.id) throw new RenderApiError({ message: "Nenhum workspace acessível com este token.", status: 403 });
  return owner as RenderOwner & { id: string };
}

async function findExistingService(token: string, name: string): Promise<RenderService | null> {
  try {
    const raw = await renderRequest<unknown>(token, "/services?limit=100");
    const items = Array.isArray(raw) ? raw : [];
    for (const item of items) {
      const record = item as Record<string, unknown>;
      const service = (record.service as RenderService | undefined) ?? (record as RenderService);
      if (service?.name === name && service?.id) return service;
    }
    return null;
  } catch {
    return null;
  }
}

// Render runs the Docker Command by splitting on whitespace and exec'ing
// directly (no shell). So the script must be a single argument with no
// spaces: a `node -e <script>` where the script embeds the config path as a
// JSON string literal (guaranteed no spaces for our paths) and writes the
// tool's config JSON (read from its env var) to that path before exec'ing
// the tool's run command.
function buildRenderDockerCommand(startup: CloudToolStartup): string {
  const script = [
    `require('node:fs').mkdirSync(require('node:path').dirname(${JSON.stringify(startup.configPath)}),{recursive:true})`,
    `require('node:fs').writeFileSync(${JSON.stringify(startup.configPath)},process.env.${startup.configEnvVar}||'{}')`,
    `process.exit(require('node:child_process').spawnSync(process.execPath,${JSON.stringify(startup.runArgs)},{stdio:'inherit'}).status||0)`,
  ].join(";");
  return `node -e ${script}`;
}

function toRenderError(error: unknown, fallbackType: CloudProviderErrorType = CloudProviderErrorType.SERVICE_UNAVAILABLE): CloudProviderError {
  if (error instanceof RenderApiError) {
    const type = isRenderFreeTierError(error)
      ? CloudProviderErrorType.FREE_TIER_LIMIT
      : error.status === 401 || error.status === 403
        ? CloudProviderErrorType.AUTHENTICATION
        : error.status === 404
          ? CloudProviderErrorType.RESOURCE_NOT_FOUND
          : error.status === 409
            ? CloudProviderErrorType.RESOURCE_CONFLICT
            : fallbackType;
    return new CloudProviderError(type, "render", error.message, error);
  }
  return new CloudProviderError(CloudProviderErrorType.UNKNOWN, "render", error instanceof Error ? error.message : "Unknown error", error);
}

export const renderDriver: CloudProviderDriver = {
  async validateToken(token: string): Promise<AccountMetadata> {
    try {
      const owner = await requireRenderOwner(token);
      return {
        externalUserEmail: owner.email ?? null,
        externalUserId: owner.id,
        externalOrgId: owner.id,
        externalOrgName: owner.name ?? null,
      };
    } catch (error) {
      throw toRenderError(error, CloudProviderErrorType.AUTHENTICATION);
    }
  },

  async createDeployment(token: string, resourceName: string, tool: CloudToolManifest, env: CloudToolEnvInput): Promise<DeployResult> {
    try {
      const owner = await requireRenderOwner(token);
      const plannedServiceUrl = `https://${resourceName}.onrender.com`;
      const fullEnv: CloudToolEnvInput = { ...env, serviceUrl: plannedServiceUrl };
      const envVars = tool.buildEnv(fullEnv);
      const dockerCommand = buildRenderDockerCommand(tool.startup);

      const existing = await findExistingService(token, resourceName);
      if (existing?.id) {
        const existingId = encodeURIComponent(existing.id);
        await renderRequest(token, `/services/${existingId}/env-vars`, { body: JSON.stringify(envVars), method: "PUT" });
        await renderRequest(token, `/services/${existingId}`, {
          body: JSON.stringify({ serviceDetails: { envSpecificDetails: { dockerCommand }, healthCheckPath: "", runtime: "image" } }),
          method: "PATCH",
        });
        type DeployResponse = { deploy?: { id?: string } } | { id?: string };
        const deployReply = await renderRequest<DeployResponse>(token, `/services/${existingId}/deploys`, {
          body: JSON.stringify({ clearCache: "do_not_clear" }), method: "POST",
        });
        const deployId = ("deploy" in deployReply ? deployReply.deploy?.id : (deployReply as { id?: string }).id) ?? null;
        return {
          externalServiceId: existing.id,
          externalDeployId: deployId,
          publicUrl: existing.serviceDetails?.url ?? plannedServiceUrl,
          status: "provisioning",
          gatewayToken: env.gatewayToken,
        };
      }

      type CreateResponse = { deployId?: string; service?: RenderService };
      const reply = await renderRequest<CreateResponse>(token, "/services", {
        body: JSON.stringify({
          envVars,
          image: { imagePath: tool.image, ownerId: owner.id },
          name: resourceName,
          ownerId: owner.id,
          serviceDetails: {
            envSpecificDetails: { dockerCommand },
            healthCheckPath: "",
            plan: RENDER_PLAN,
            region: RENDER_REGION,
            runtime: "image",
          },
          type: "web_service",
        }),
        method: "POST",
      });

      const service = reply.service;
      if (!service?.id || !service?.name) {
        throw new RenderApiError({ message: "Render não retornou um ID de serviço.", status: 502 });
      }

      return {
        externalServiceId: service.id,
        externalDeployId: reply.deployId ?? null,
        publicUrl: service.serviceDetails?.url ?? plannedServiceUrl,
        status: "provisioning",
        gatewayToken: env.gatewayToken,
      };
    } catch (error) {
      throw toRenderError(error);
    }
  },

  async updateDeployment(token: string, externalServiceId: string, tool: CloudToolManifest, env: CloudToolEnvInput): Promise<UpdateResult> {
    try {
      const id = encodeURIComponent(externalServiceId);
      const envVars = tool.buildEnv(env);
      const dockerCommand = buildRenderDockerCommand(tool.startup);
      await renderRequest(token, `/services/${id}/env-vars`, { body: JSON.stringify(envVars), method: "PUT" });
      await renderRequest(token, `/services/${id}`, {
        body: JSON.stringify({ serviceDetails: { envSpecificDetails: { dockerCommand }, healthCheckPath: "", runtime: "image" } }),
        method: "PATCH",
      });
      type DeployResponse = { deploy?: { id?: string } } | { id?: string };
      const deployReply = await renderRequest<DeployResponse>(token, `/services/${id}/deploys`, {
        body: JSON.stringify({ clearCache: "do_not_clear" }), method: "POST",
      });
      return { externalDeployId: ("deploy" in deployReply ? deployReply.deploy?.id : (deployReply as { id?: string }).id) ?? null };
    } catch (error) {
      throw toRenderError(error);
    }
  },

  async refresh(token: string, externalServiceId: string, externalDeployId: string | null): Promise<RefreshResult> {
    try {
      const id = encodeURIComponent(externalServiceId);
      const service = await renderRequest<RenderService>(token, `/services/${id}`);
      type DeployItem = { deploy?: RenderDeploy };
      let latestDeploy: RenderDeploy | undefined;
      try {
        const deployItems = await renderRequest<DeployItem[]>(token, `/services/${id}/deploys?limit=1`);
        latestDeploy = deployItems?.[0]?.deploy;
      } catch {
        // Deploy list may fail right after creation — non-fatal.
      }
      const mapped = mapRenderDeployStatus(latestDeploy?.status, service.suspended);
      return {
        externalDeployId: latestDeploy?.id ?? externalDeployId,
        error: mapped.error,
        missing: false,
        publicUrl: service.serviceDetails?.url ?? null,
        status: mapped.status,
      };
    } catch (error) {
      if (error instanceof RenderApiError && error.status === 404) {
        return { externalDeployId, error: null, missing: true, publicUrl: null, status: "failed" };
      }
      throw toRenderError(error);
    }
  },

  async deleteService(token: string, externalServiceId: string): Promise<"deleted" | "missing"> {
    try {
      await renderRequest(token, `/services/${encodeURIComponent(externalServiceId)}`, { method: "DELETE" });
      return "deleted";
    } catch (error) {
      if (error instanceof RenderApiError && error.status === 404) return "missing";
      throw toRenderError(error);
    }
  },

  isFreeTierError: isRenderFreeTierError,
};
