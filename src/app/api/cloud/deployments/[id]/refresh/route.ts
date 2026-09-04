import { NextRequest, NextResponse } from "next/server";
import { getCloudDeploymentById, getCloudConnectionById, updateCloudDeployment } from "@/models";
import { getCloudProviderDriver } from "@/server/cloud/providers/registry";
import { isCloudProviderError, formatCloudProviderError } from "@/server/cloud/providers/driver";

export async function POST(_request: NextRequest, { params }: RouteContext<"/api/cloud/deployments/[id]/refresh">) {
  const { id } = await params;
  const deployment = await getCloudDeploymentById(id);
  if (!deployment) return NextResponse.json({ error: "Deployment não encontrado" }, { status: 404 });

  const connection = await getCloudConnectionById(deployment.connectionId);
  if (!connection) return NextResponse.json({ error: "Conexão não encontrada — pode ter sido desconectada." }, { status: 400 });
  const driver = getCloudProviderDriver(deployment.provider);
  if (!driver) return NextResponse.json({ error: "Provider não suportado" }, { status: 400 });

  try {
    const refreshed = await driver.refresh(connection.token, deployment.externalServiceId, deployment.externalDeployId);
    if (refreshed.missing) {
      await updateCloudDeployment(id, { status: "failed", error: "Serviço não encontrado no provider — pode ter sido apagado externamente." });
    } else {
      await updateCloudDeployment(id, {
        status: refreshed.status,
        publicUrl: refreshed.publicUrl ?? deployment.publicUrl,
        error: refreshed.error,
        externalDeployId: refreshed.externalDeployId ?? deployment.externalDeployId,
      });
    }
    const updated = await getCloudDeploymentById(id);
    const { gatewayToken: _gatewayToken, ...rest } = updated!;
    return NextResponse.json({ deployment: rest });
  } catch (error) {
    if (isCloudProviderError(error)) {
      return NextResponse.json({ error: formatCloudProviderError(error) }, { status: 502 });
    }
    console.error("[cloud/deployments] failed to refresh deployment", error);
    return NextResponse.json({ error: "Falha ao atualizar status" }, { status: 500 });
  }
}
