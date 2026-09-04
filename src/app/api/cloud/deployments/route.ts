import { NextRequest, NextResponse } from "next/server";
import { createCloudDeployment, getCloudConnectionByProvider, getCloudDeployments, issueApiKeyForSink, type ApiKeySink } from "@/models";
import { getCloudTool } from "@/server/cloud/tools/registry";
import { getCloudProviderDriver } from "@/server/cloud/providers/registry";
import { generateResourceName, isCloudProviderError, formatCloudProviderError } from "@/server/cloud/providers/driver";
import { resolveGatewayConfig } from "@/server/cloud/gatewayConfig";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { randomBytes } from "node:crypto";

function serializeDeployment(d: Awaited<ReturnType<typeof getCloudDeployments>>[number]) {
  const { gatewayToken: _gatewayToken, ...rest } = d;
  return rest;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const toolId = searchParams.get("toolId") ?? undefined;
  const provider = searchParams.get("provider") ?? undefined;
  const deployments = await getCloudDeployments({ toolId, provider });
  return NextResponse.json({ deployments: deployments.map(serializeDeployment) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const provider = typeof body?.provider === "string" ? body.provider : "";
  const toolId = typeof body?.toolId === "string" ? body.toolId : "";
  const model = typeof body?.model === "string" ? body.model : "";
  const modelProvider = typeof body?.modelProvider === "string" ? body.modelProvider : "";

  const driver = getCloudProviderDriver(provider);
  const tool = getCloudTool(toolId);
  if (!driver) return NextResponse.json({ error: "Provider não suportado" }, { status: 400 });
  if (!tool) return NextResponse.json({ error: "Ferramenta não disponível para deploy em nuvem" }, { status: 400 });
  if (!model || !modelProvider) return NextResponse.json({ error: "model e modelProvider são obrigatórios" }, { status: 400 });

  const connection = await getCloudConnectionByProvider(provider);
  if (!connection) return NextResponse.json({ error: "Conecte sua conta antes de fazer deploy" }, { status: 400 });

  const existingDeployments = await getCloudDeployments({ toolId, provider });
  if (existingDeployments.some((d) => d.status !== "failed")) {
    return NextResponse.json(
      { error: "Já existe um deployment ativo para esta ferramenta neste provider. Apague-o antes de criar outro." },
      { status: 409 },
    );
  }

  const { gatewayApiUrl } = await resolveGatewayConfig();
  if (!gatewayApiUrl) return NextResponse.json({ error: "Configure a URL pública do squid (Cloud/Tunnel) antes de fazer deploy" }, { status: 400 });

  const resourceName = generateResourceName(toolId);
  const gatewayToken = randomBytes(32).toString("hex");

  // The gateway key used to come from the request body, which meant whichever
  // key the operator had selected — typically the one already written to every
  // CLI config file — was pushed as a plaintext env var onto a third-party
  // platform. It still has to leave the machine for the container to work, but
  // now it is a key issued for this destination alone, recorded against it, and
  // revoked by the teardown path. Rotating it no longer touches anything else.
  // tool AND provider: the unique index is (toolId, provider), so two tools can
  // hold deployments on the same platform. Keying the sink on provider alone
  // would make tearing one down revoke the key the other is still using.
  const sink = `cloud:${provider}.${toolId}` as ApiKeySink;
  const gatewayKey = await issueApiKeyForSink(
    `Cloud deploy · ${toolId} · ${provider}`,
    await getConsistentMachineId(),
    sink,
    resourceName,
  );
  const gatewayApiKey = gatewayKey.key;

  try {
    const result = await driver.createDeployment(connection.token, resourceName, tool, {
      gatewayToken, gatewayApiUrl, gatewayApiKey, model, provider: modelProvider, serviceUrl: "",
    });
    const deployment = await createCloudDeployment({
      connectionId: connection.id,
      provider,
      toolId,
      status: result.status,
      publicUrl: result.publicUrl,
      image: tool.image,
      region: typeof body?.region === "string" ? body.region : "",
      instanceType: "free",
      port: tool.port,
      externalServiceId: result.externalServiceId,
      externalDeployId: result.externalDeployId,
      gatewayToken: result.gatewayToken,
      config: { model, modelProvider },
    });
    return NextResponse.json({ deployment: serializeDeployment(deployment) }, { status: 201 });
  } catch (error) {
    if (isCloudProviderError(error)) {
      return NextResponse.json({ error: formatCloudProviderError(error) }, { status: 502 });
    }
    if (error instanceof Error && error.message.includes("idx_cd_tool_provider_active")) {
      return NextResponse.json(
        { error: "Já existe um deployment ativo para esta ferramenta neste provider. Apague-o antes de criar outro." },
        { status: 409 },
      );
    }
    console.error("[cloud/deployments] failed to create deployment", error);
    return NextResponse.json({ error: "Falha ao criar deployment" }, { status: 500 });
  }
}
