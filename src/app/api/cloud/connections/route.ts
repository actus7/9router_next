import { NextResponse } from "next/server";
import { getCloudConnections } from "@/models";

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
  const connections = await getCloudConnections();
  return NextResponse.json({ connections: connections.map(serializeConnection) });
}
