import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextRequest, NextResponse  } from "next/server";
import { createProxyPool, deleteProxyPools, getProviderConnections, getProxyPools, setProxyPoolsActive } from "@/models";
import { countBoundConnections } from "./boundConnections";

function toBoolean(value: string | null) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

const VALID_PROXY_TYPES = ["http", "vercel", "cloudflare", "deno"];

function normalizeProxyPoolInput(body: Record<string, unknown> = {}) {
  const name = typeof body?.name === "string" ? (body.name as string).trim() : "";
  const proxyUrl = typeof body?.proxyUrl === "string" ? (body.proxyUrl as string).trim() : "";
  const noProxy = typeof body?.noProxy === "string" ? (body.noProxy as string).trim() : "";
  const isActive = body?.isActive === undefined ? true : body.isActive === true;
  const strictProxy = body?.strictProxy === true;
  const type = VALID_PROXY_TYPES.includes(body?.type as string) ? (body.type as string) : "http";

  if (!name) {
    return { error: "Name is required" };
  }

  if (!proxyUrl) {
    return { error: "Proxy URL is required" };
  }

  return { name, proxyUrl, noProxy, isActive, strictProxy, type };
}

function buildUsageMap(connections: Record<string, unknown>[] = []) {
  const usageMap = new Map();

  for (const connection of connections) {
    const proxyPoolId = (connection?.providerSpecificData as Record<string, unknown>)?.proxyPoolId;
    if (!proxyPoolId) continue;

    usageMap.set(proxyPoolId, (usageMap.get(proxyPoolId) || 0) + 1);
  }

  return usageMap;
}

// GET /api/proxy-pools - List proxy pools
async function handleGET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const isActive = toBoolean(searchParams.get("isActive"));
    const includeUsage = searchParams.get("includeUsage") === "true";

    const filter: Record<string, unknown> = {};
    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    const proxyPools = await getProxyPools(filter);

    if (!includeUsage) {
      return NextResponse.json({ proxyPools });
    }

    const connections = await getProviderConnections();
    const usageMap = buildUsageMap(connections);

    const enrichedProxyPools = proxyPools.map((pool) => ({
      ...pool,
      boundConnectionCount: usageMap.get(pool.id) || 0,
    }));

    return NextResponse.json({ proxyPools: enrichedProxyPools });
  } catch (error) {
    console.error("Error fetching proxy pools:", error);
    return NextResponse.json({ error: "Failed to fetch proxy pools" }, { status: 500 });
  }
}

// POST /api/proxy-pools - Create proxy pool
async function handlePOST(request: NextRequest) {
  try {
    const body = await request.json();
    const normalized = normalizeProxyPoolInput(body);

    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const proxyPool = await createProxyPool(normalized);
    return NextResponse.json({ proxyPool }, { status: 201 });
  } catch (error) {
    console.error("Error creating proxy pool:", error);
    return NextResponse.json({ error: "Failed to create proxy pool" }, { status: 500 });
  }
}

/**
 * PATCH /api/proxy-pools - flip `isActive` for several pools at once.
 * DELETE /api/proxy-pools - delete several pools, refusing the bound ones.
 *
 * Both were loops of single-pool requests in the dashboard, run one after the
 * other: 50 pools meant 50 sequential round-trips per gesture.
 */
async function handlePATCH(request: NextRequest) {
  try {
    const { ids, isActive } = await request.json();
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || typeof isActive !== "boolean") {
      return NextResponse.json({ error: "ids[] and isActive required" }, { status: 400 });
    }
    const updated = await setProxyPoolsActive(ids as string[], isActive);
    return NextResponse.json({ success: true, updated });
  } catch (error) {
    console.error("Error updating proxy pools:", error);
    return NextResponse.json({ error: "Failed to update proxy pools" }, { status: 500 });
  }
}

async function handleDELETE(request: NextRequest) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "ids[] required" }, { status: 400 });
    }
    // The binding check the single-pool route answers with a 409: read the
    // connections once, then decide for every pool in the batch.
    const connections = await getProviderConnections();
    const result = await deleteProxyPools(ids as string[], (poolId) => countBoundConnections(connections, poolId) > 0);
    return NextResponse.json({ success: true, deleted: result.deleted.length, blocked: result.blocked });
  } catch (error) {
    console.error("Error deleting proxy pools:", error);
    return NextResponse.json({ error: "Failed to delete proxy pools" }, { status: 500 });
  }
}

export const GET = tenantRoute(handleGET);
export const POST = tenantRoute(handlePOST);
export const PATCH = tenantRoute(handlePATCH);
export const DELETE = tenantRoute(handleDELETE);
