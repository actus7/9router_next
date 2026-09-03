import { NextResponse } from "next/server";
import { getCloudConnections } from "@/models";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";

function serializeConnection(c: Awaited<ReturnType<typeof getCloudConnections>>[number]) {
  return {
    id: c.id,
    provider: c.provider,
    label: c.label,
    externalUserEmail: c.externalUserEmail,
    externalOrgName: c.externalOrgName,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function GET() {
  await assertRequestRuntime();
  const connections = await getCloudConnections();
  return NextResponse.json({ connections: connections.map(serializeConnection) });
}
