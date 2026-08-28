import { NextRequest, NextResponse } from "next/server";
import { createCloudConnection, deleteCloudConnection, getCloudConnectionByProvider } from "@/models";
import { getCloudProviderDriver } from "@/server/cloud/providers/registry";
import { isCloudProviderError, formatCloudProviderError } from "@/server/cloud/providers/driver";

type Params = { params: Promise<{ provider: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { provider } = await params;
  const driver = getCloudProviderDriver(provider);
  if (!driver) {
    return NextResponse.json({ error: "Provider não suportado" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Token é obrigatório" }, { status: 400 });
  }

  try {
    const metadata = await driver.validateToken(token);
    const connection = await createCloudConnection({
      provider,
      label: typeof body?.label === "string" ? body.label : undefined,
      token,
      externalUserEmail: metadata.externalUserEmail,
      externalOrgId: metadata.externalOrgId,
      externalOrgName: metadata.externalOrgName,
    });
    return NextResponse.json({
      connection: {
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        externalUserEmail: connection.externalUserEmail,
        externalOrgName: connection.externalOrgName,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      },
    }, { status: 201 });
  } catch (error) {
    if (isCloudProviderError(error)) {
      return NextResponse.json({ error: formatCloudProviderError(error) }, { status: 401 });
    }
    console.error("[cloud/connections] failed to validate token", error);
    return NextResponse.json({ error: "Falha ao validar token" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { provider } = await params;
  const existing = await getCloudConnectionByProvider(provider);
  if (!existing) {
    return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
  }
  await deleteCloudConnection(existing.id);
  return NextResponse.json({ success: true });
}
