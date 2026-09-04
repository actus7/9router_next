import { NextRequest, NextResponse } from "next/server";
import { deleteCloudDeployment, getCloudDeploymentById, getCloudConnectionById, revokeApiKeysForSink, type ApiKeySink } from "@/models";
import { getCloudProviderDriver } from "@/server/cloud/providers/registry";
import { isCloudProviderError, formatCloudProviderError } from "@/server/cloud/providers/driver";

export async function DELETE(_request: NextRequest, { params }: RouteContext<"/api/cloud/deployments/[id]">) {
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

  // The key this deployment was issued has to die with it. Tearing down the
  // container while leaving a live gateway key in a third party's environment
  // is the leak the per-destination scheme exists to close. Deliberately after
  // the external delete: a key that outlives a failed teardown is recoverable,
  // a container that outlives its key is not.
  await revokeApiKeysForSink(`cloud:${deployment.provider}.${deployment.toolId}` as ApiKeySink);

  return NextResponse.json({ success: true });
}
