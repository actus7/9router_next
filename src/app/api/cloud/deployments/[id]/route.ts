import { NextRequest, NextResponse } from "next/server";
import { deleteCloudDeployment, getCloudDeploymentById, getCloudConnectionById } from "@/models";
import { getCloudProviderDriver } from "@/server/cloud/providers/registry";
import { isCloudProviderError, formatCloudProviderError } from "@/server/cloud/providers/driver";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deployment = await getCloudDeploymentById(id);
  if (!deployment) return NextResponse.json({ error: "Deployment não encontrado" }, { status: 404 });

  const connection = await getCloudConnectionById(deployment.connectionId);
  const driver = getCloudProviderDriver(deployment.provider);

  if (connection && driver) {
    try {
      await driver.deleteService(connection.token, deployment.externalServiceId);
    } catch (error) {
      if (isCloudProviderError(error)) {
        return NextResponse.json({ error: formatCloudProviderError(error) }, { status: 502 });
      }
      console.error("[cloud/deployments] failed to delete external service", error);
    }
  }

  await deleteCloudDeployment(id);
  return NextResponse.json({ success: true });
}
