import { testStatusForValidation } from "@/lib/db/repos/connectionsRepo";
import { NextRequest, NextResponse } from "next/server";
import {
  getProviderConnectionById,
  getProxyPoolById,
  updateProviderConnection,
  deleteProviderConnection,
} from "@/models";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ProxyConfigResult {
  hasAnyProxyField: boolean;
  error?: string;
  connectionProxyEnabled?: boolean;
  connectionProxyUrl?: string;
  connectionNoProxy?: string;
}

function normalizeProxyConfig(body: Record<string, unknown> = {}): ProxyConfigResult {
  const hasAnyProxyField =
    Object.prototype.hasOwnProperty.call(body, "connectionProxyEnabled") ||
    Object.prototype.hasOwnProperty.call(body, "connectionProxyUrl") ||
    Object.prototype.hasOwnProperty.call(body, "connectionNoProxy");

  if (!hasAnyProxyField) return { hasAnyProxyField: false };

  const enabled = body?.connectionProxyEnabled === true;
  const url = typeof body?.connectionProxyUrl === "string" ? (body.connectionProxyUrl as string).trim() : "";
  const noProxy = typeof body?.connectionNoProxy === "string" ? (body.connectionNoProxy as string).trim() : "";

  if (enabled && !url) {
    return {
      hasAnyProxyField: true,
      error: "Connection proxy URL is required when connection proxy is enabled",
    };
  }

  return {
    hasAnyProxyField: true,
    connectionProxyEnabled: enabled,
    connectionProxyUrl: url,
    connectionNoProxy: noProxy,
  };
}

async function normalizeProxyPoolUpdate(proxyPoolIdInput: unknown): Promise<{ hasProxyPoolField: boolean; proxyPoolId: string | null; error?: string }> {
  if (proxyPoolIdInput === undefined) {
    return { hasProxyPoolField: false, proxyPoolId: null };
  }

  if (proxyPoolIdInput === null || proxyPoolIdInput === "" || proxyPoolIdInput === "__none__") {
    return { hasProxyPoolField: true, proxyPoolId: null };
  }

  const proxyPoolId = String(proxyPoolIdInput).trim();
  if (!proxyPoolId) {
    return { hasProxyPoolField: true, proxyPoolId: null };
  }

  const proxyPool = await getProxyPoolById(proxyPoolId);
  if (!proxyPool) {
    return { hasProxyPoolField: true, proxyPoolId: null, error: "Proxy pool not found" };
  }

  return { hasProxyPoolField: true, proxyPoolId };
}

function shouldMergeProviderSpecificData(existing: unknown, incoming: unknown, hasLegacyProxy: boolean, hasProxyPoolField: boolean): boolean {
  return existing !== undefined || incoming !== undefined || hasLegacyProxy || hasProxyPoolField;
}

// GET /api/providers/[id] - Get single connection
export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Hide sensitive fields
    const result = { ...connection };
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;

    return NextResponse.json({ connection: result });
  } catch (error) {
    console.error("Error fetching connection:", error);
    return NextResponse.json({ error: "Failed to fetch connection" }, { status: 500 });
  }
}

// PUT /api/providers/[id] - Update connection
export async function PUT(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      priority,
      globalPriority,
      defaultModel,
      isActive,
      apiKey,
      providerSpecificData
    } = body;

    const existing = await getProviderConnectionById(id);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const proxyConfig = normalizeProxyConfig(body);
    if (proxyConfig.error) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }

    const proxyPoolResult = await normalizeProxyPoolUpdate(body.proxyPoolId);
    if (proxyPoolResult.error) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (priority !== undefined) updateData.priority = priority;
    if (globalPriority !== undefined) updateData.globalPriority = globalPriority;
    if (defaultModel !== undefined) updateData.defaultModel = defaultModel;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (apiKey && existing.authType === "apikey") updateData.apiKey = apiKey;
    // Same rule as creation: the caller reports validation, the server decides.
    if (body.validated !== undefined) {
      updateData.testStatus = testStatusForValidation(body.validated === true);
      if (body.validated === true) {
        updateData.lastError = null;
        updateData.lastErrorAt = null;
      }
    }

    if (
      shouldMergeProviderSpecificData(
        existing.providerSpecificData,
        providerSpecificData,
        proxyConfig.hasAnyProxyField,
        proxyPoolResult.hasProxyPoolField
      )
    ) {
      updateData.providerSpecificData = {
        ...((existing.providerSpecificData as Record<string, unknown>) || {}),
        ...(providerSpecificData || {}),
      };

      if (proxyConfig.hasAnyProxyField) {
        (updateData.providerSpecificData as Record<string, unknown>).connectionProxyEnabled = proxyConfig.connectionProxyEnabled;
        (updateData.providerSpecificData as Record<string, unknown>).connectionProxyUrl = proxyConfig.connectionProxyUrl;
        (updateData.providerSpecificData as Record<string, unknown>).connectionNoProxy = proxyConfig.connectionNoProxy;
      }

      if (proxyPoolResult.hasProxyPoolField) {
        if (proxyPoolResult.proxyPoolId === null) {
          delete (updateData.providerSpecificData as Record<string, unknown>).proxyPoolId;
        } else {
          (updateData.providerSpecificData as Record<string, unknown>).proxyPoolId = proxyPoolResult.proxyPoolId;
        }
      }
    }

    const updated = await updateProviderConnection(id, updateData);

    // Hide sensitive fields
    const result = { ...updated };
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;

    return NextResponse.json({ connection: result });
  } catch (error) {
    console.error("Error updating connection:", error);
    return NextResponse.json({ error: "Failed to update connection" }, { status: 500 });
  }
}

// DELETE /api/providers/[id] - Delete connection
export async function DELETE(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await params;

    const deleted = await deleteProviderConnection(id);
    if (!deleted) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Connection deleted successfully" });
  } catch (error) {
    console.error("Error deleting connection:", error);
    return NextResponse.json({ error: "Failed to delete connection" }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
