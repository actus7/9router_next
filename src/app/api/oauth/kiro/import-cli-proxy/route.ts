import { TEST_STATUS_ON_CREDENTIAL_ACQUIRED } from "@/models";
import { NextRequest, NextResponse  } from "next/server";
import { createProviderConnection } from "@/models";
import { normalizeKiroExternalIdpAuth } from "@/lib/oauth/kiroExternalIdp";

/**
 * POST /api/oauth/kiro/import-cli-proxy
 * Import Kiro CLIProxyAPI auth JSON for Microsoft external_idp accounts.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawAuth = body?.cliProxyAuth ?? body?.auth ?? body?.json ?? body;
    const tokenData = normalizeKiroExternalIdpAuth(rawAuth);

    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken ?? undefined,
      expiresAt: tokenData.expiresAt,
      email: tokenData.email ?? undefined,
      providerSpecificData: tokenData.providerSpecificData,
      testStatus: TEST_STATUS_ON_CREDENTIAL_ACQUIRED,
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection!.id,
        provider: connection!.provider,
        email: connection!.email,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "CLIProxyAPI import failed" },
      { status: 400 }
    );
  }
}
