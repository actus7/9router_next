import type { CloudToolManifest, CloudToolEnvInput, CloudToolStartup } from "../tools/types";
import type { CloudProviderDriver, AccountMetadata, DeployResult, RefreshResult, CloudDeploymentStatus } from "./driver";
import { CloudProviderError, CloudProviderErrorType } from "./driver";

const RAILWAY_API_BASE = "https://backboard.railway.app/graphql/v2";
const RAILWAY_PORT_FALLBACK = 10000;

type RailwayUser = { id: string; name?: string; email?: string };
type RailwayProject = { id: string; name: string };
type RailwayEnvironment = { id: string; name: string };
type RailwayService = { id: string; name: string };
type RailwayDeployment = { id: string; status: string; url?: string; createdAt: string };

async function railwayRequest<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(RAILWAY_API_BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new CloudProviderError(
      response.status === 401 ? CloudProviderErrorType.AUTHENTICATION : CloudProviderErrorType.SERVICE_UNAVAILABLE,
      "railway",
      `Railway API error: ${response.status} ${response.statusText} — ${body}`,
    );
  }

  const result = await response.json();
  if (result.errors) {
    const isAuth = (result.errors as Array<{ message?: string }>).some((err) => {
      const msg = (err.message ?? "").toLowerCase();
      return msg.includes("unauthorized") || msg.includes("not authorized") || msg.includes("authentication") || msg.includes("forbidden");
    });
    throw new CloudProviderError(
      isAuth ? CloudProviderErrorType.AUTHENTICATION : CloudProviderErrorType.UNKNOWN,
      "railway",
      `Railway GraphQL errors: ${JSON.stringify(result.errors)}`,
    );
  }
  return result.data;
}

const VALIDATE_TOKEN_QUERY = `query ValidateToken { me { id name email } }`;
const LIST_WORKSPACES_QUERY = `query ListWorkspaces { me { workspaces { id name } } }`;
const LIST_PROJECTS_QUERY = `query ListProjects { me { projects { edges { node { id name } } } } }`;
const CREATE_PROJECT_MUTATION = `mutation CreateProject($input: ProjectCreateInput!) { projectCreate(input: $input) { id name } }`;
const GET_PROJECT_ENVIRONMENTS_QUERY = `query GetProjectEnvironments($projectId: String!) { project(id: $projectId) { environments { edges { node { id name } } } } }`;
const CREATE_SERVICE_MUTATION = `mutation CreateService($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }`;
const UPSERT_VARIABLES_MUTATION = `mutation UpsertVariables($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`;
const UPDATE_SERVICE_INSTANCE_MUTATION = `mutation UpdateServiceInstance($serviceId: String!, $environmentId: String, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }`;
const CREATE_SERVICE_DOMAIN_MUTATION = `mutation CreateServiceDomain($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }`;
const TRIGGER_DEPLOY_MUTATION = `mutation TriggerDeploy($input: EnvironmentTriggersDeployInput!) { environmentTriggersDeploy(input: $input) }`;
const GET_DEPLOYMENT_QUERY = `query GetDeployment($id: String!) { deployment(id: $id) { id status createdAt url } }`;
const LIST_SERVICE_DEPLOYMENTS_QUERY = `query ListServiceDeployments($serviceId: String!, $environmentId: String!) { deployments(first: 1, input: { serviceId: $serviceId, environmentId: $environmentId }) { edges { node { id status createdAt url } } } }`;
const GET_SERVICE_URL_QUERY = `query GetServiceUrl($id: String!) { service(id: $id) { id serviceInstances { edges { node { environmentId domains { serviceDomains { domain } } } } } } }`;
const DELETE_SERVICE_MUTATION = `mutation DeleteService($id: String!) { serviceDelete(id: $id) }`;
const DELETE_PROJECT_MUTATION = `mutation DeleteProject($id: String!) { projectDelete(id: $id) }`;

function mapRailwayDeploymentStatus(status: string): { status: CloudDeploymentStatus; error: string | null } {
  switch (status?.toLowerCase()) {
    case "success":
    case "active":
      return { status: "healthy", error: null };
    case "queued":
    case "building":
    case "deploying":
      return { status: "provisioning", error: null };
    case "failed":
    case "crashed":
    case "removed":
      return { status: "failed", error: "Deploy falhou no Railway." };
    case "sleeping":
    case "skipped":
      return { status: "healthy", error: null };
    default:
      return { status: "provisioning", error: null };
  }
}

// Railway validates the start command as a Docker exec form; `sh -c` with
// single quotes avoids shell-escaping issues since the JSON config may
// contain double quotes. `printf` (not `echo`) handles arbitrary content
// safely. Mirrors buildRenderDockerCommand's intent for the shell dialect
// Railway actually runs.
function buildRailwayStartCommand(startup: CloudToolStartup): string {
  const args = startup.runArgs.join(" ");
  return `sh -c 'mkdir -p $(dirname ${startup.configPath}) && printf "%s" "$${startup.configEnvVar}" > ${startup.configPath} && exec node ${args}'`;
}

function toRailwayError(error: unknown): CloudProviderError {
  if (error instanceof CloudProviderError) return error;
  return new CloudProviderError(CloudProviderErrorType.UNKNOWN, "railway", error instanceof Error ? error.message : "Unknown error", error);
}

async function createRailwayDeployment(token: string, resourceName: string, tool: CloudToolManifest, env: CloudToolEnvInput): Promise<DeployResult> {
  await railwayRequest<{ me: RailwayUser }>(token, VALIDATE_TOKEN_QUERY);

  let workspaceId: string | undefined;
  try {
    const ws = await railwayRequest<{ me: { workspaces: Array<{ id: string; name: string }> } }>(token, LIST_WORKSPACES_QUERY);
    workspaceId = ws.me.workspaces?.[0]?.id;
  } catch {
    // Optional for personal accounts.
  }

  const projects = await railwayRequest<{ me: { projects: { edges: Array<{ node: RailwayProject }> } } }>(token, LIST_PROJECTS_QUERY);
  let projectId: string;
  const existingProject = projects?.me?.projects?.edges?.find((e) => e?.node?.name === resourceName);
  if (existingProject) {
    projectId = existingProject.node.id;
  } else {
    const created = await railwayRequest<{ projectCreate: RailwayProject }>(token, CREATE_PROJECT_MUTATION, {
      input: workspaceId ? { name: resourceName, workspaceId } : { name: resourceName },
    });
    projectId = created.projectCreate.id;
  }

  const environments = await railwayRequest<{ project: { environments: { edges: Array<{ node: RailwayEnvironment }> } } }>(
    token, GET_PROJECT_ENVIRONMENTS_QUERY, { projectId },
  );
  const productionEnv = environments?.project?.environments?.edges?.find((e) => e?.node?.name?.toLowerCase() === "production");
  if (!productionEnv) {
    throw new CloudProviderError(CloudProviderErrorType.RESOURCE_NOT_FOUND, "railway", "Environment 'production' não encontrado no projeto Railway.");
  }
  const environmentId = productionEnv.node.id;

  const service = await railwayRequest<{ serviceCreate: RailwayService }>(token, CREATE_SERVICE_MUTATION, {
    input: { projectId, name: tool.id, source: { image: tool.image } },
  });
  const serviceId = service.serviceCreate.id;

  await railwayRequest(token, UPDATE_SERVICE_INSTANCE_MUTATION, {
    serviceId, environmentId, input: { startCommand: buildRailwayStartCommand(tool.startup) },
  });

  let generatedDomain: string | null = null;
  try {
    const domainResult = await railwayRequest<{ serviceDomainCreate: { domain: string } }>(token, CREATE_SERVICE_DOMAIN_MUTATION, {
      input: { environmentId, serviceId, targetPort: tool.port || RAILWAY_PORT_FALLBACK },
    });
    generatedDomain = domainResult?.serviceDomainCreate?.domain ?? null;
  } catch {
    // Best-effort — refresh will retry via GET_SERVICE_URL_QUERY.
  }
  const publicUrl = generatedDomain ? `https://${generatedDomain}` : null;

  const envVars = tool.buildEnv({ ...env, serviceUrl: publicUrl ?? "" });
  const variables: Record<string, string> = {};
  for (const { key, value } of envVars) variables[key] = value;
  await railwayRequest(token, UPSERT_VARIABLES_MUTATION, { input: { projectId, environmentId, serviceId, variables } });

  await railwayRequest(token, TRIGGER_DEPLOY_MUTATION, { input: { environmentId, projectId, serviceId } });
  // Encode projectId/environmentId into the composite id so update/refresh/delete
  // don't need a separate DB lookup to find them.
  const compositeServiceId = `${serviceId}:${projectId}:${environmentId}`;

  return { externalServiceId: compositeServiceId, externalDeployId: null, publicUrl, status: "provisioning", gatewayToken: env.gatewayToken };
}

async function refreshRailwayDeployment(token: string, compositeServiceId: string, externalDeployId: string | null): Promise<RefreshResult> {
  const [serviceId, , environmentId] = compositeServiceId.split(":");
  try {
    let dep: RailwayDeployment;
    if (externalDeployId) {
      const data = await railwayRequest<{ deployment: RailwayDeployment }>(token, GET_DEPLOYMENT_QUERY, { id: externalDeployId });
      dep = data.deployment;
    } else {
      const data = await railwayRequest<{ deployments: { edges: Array<{ node: RailwayDeployment }> } }>(
        token, LIST_SERVICE_DEPLOYMENTS_QUERY, { serviceId, environmentId },
      );
      const node = data.deployments.edges[0]?.node;
      if (!node) return { externalDeployId: null, error: null, missing: false, publicUrl: null, status: "provisioning" };
      dep = node;
    }

    const mapped = mapRailwayDeploymentStatus(dep.status);
    let publicUrl: string | null = dep.url || null;
    if (!publicUrl && mapped.status === "healthy") {
      try {
        const svc = await railwayRequest<{
          service: { serviceInstances: { edges: Array<{ node: { environmentId?: string; domains?: { serviceDomains?: Array<{ domain: string }> } } }> } };
        }>(token, GET_SERVICE_URL_QUERY, { id: serviceId });
        const edges = svc?.service?.serviceInstances?.edges || [];
        const matching = environmentId ? edges.find((e) => e?.node?.environmentId === environmentId) : edges[0];
        const domain = matching?.node?.domains?.serviceDomains?.[0]?.domain;
        if (domain) publicUrl = `https://${domain}`;
      } catch {
        // Best-effort.
      }
    }

    return { externalDeployId: dep.id, error: mapped.error, missing: false, publicUrl, status: mapped.status };
  } catch (error) {
    if (error instanceof CloudProviderError && error.type === CloudProviderErrorType.RESOURCE_NOT_FOUND) {
      return { externalDeployId, error: null, missing: true, publicUrl: null, status: "failed" };
    }
    throw error;
  }
}

async function deleteRailwayService(token: string, compositeServiceId: string): Promise<"deleted" | "missing"> {
  const [serviceId, projectId] = compositeServiceId.split(":");
  if (projectId) {
    try {
      await railwayRequest(token, DELETE_PROJECT_MUTATION, { id: projectId });
      return "deleted";
    } catch (error) {
      if (error instanceof CloudProviderError && error.type === CloudProviderErrorType.RESOURCE_NOT_FOUND) return "missing";
    }
  }
  try {
    await railwayRequest(token, DELETE_SERVICE_MUTATION, { id: serviceId });
    return "deleted";
  } catch (error) {
    if (error instanceof CloudProviderError && error.type === CloudProviderErrorType.RESOURCE_NOT_FOUND) return "missing";
    throw error;
  }
}

export const railwayDriver: CloudProviderDriver = {
  async validateToken(token: string): Promise<AccountMetadata> {
    const data = await railwayRequest<{ me: RailwayUser }>(token, VALIDATE_TOKEN_QUERY);
    if (!data.me?.id) throw new CloudProviderError(CloudProviderErrorType.AUTHENTICATION, "railway", "Token Railway válido mas sem acesso a dados do usuário.");
    return {
      externalUserEmail: data.me.email ?? null,
      externalUserId: data.me.id,
      externalOrgId: data.me.id,
      externalOrgName: data.me.name ?? null,
    };
  },

  async createDeployment(token, resourceName, tool, env) {
    try {
      return await createRailwayDeployment(token, resourceName, tool, env);
    } catch (error) {
      throw toRailwayError(error);
    }
  },

  async refresh(token, externalServiceId, externalDeployId) {
    try {
      return await refreshRailwayDeployment(token, externalServiceId, externalDeployId);
    } catch (error) {
      throw toRailwayError(error);
    }
  },

  async deleteService(token, externalServiceId) {
    try {
      return await deleteRailwayService(token, externalServiceId);
    } catch (error) {
      throw toRailwayError(error);
    }
  },
};
