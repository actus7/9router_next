import { NextRequest, NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { backfillCodexEmails } from "@/lib/oauth/providers";
import { USAGE_APIKEY_PROVIDERS, USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import { getUsageStats } from "@/lib/db/repos/usageRepo";

const SAFE_FIELDS = [
  "id", "provider", "authType", "name", "email", "displayName",
  "priority", "globalPriority", "isActive", "defaultModel",
  "testStatus", "lastError", "lastErrorAt", "errorCode",
  "expiresAt", "lastUsedAt", "consecutiveUseCount",
  "createdAt", "updatedAt", "usageOnly",
];

const SAFE_PSD_FIELDS = [
  "baseUrl", "azureEndpoint", "deployment", "apiVersion", "accountId",
  "region", "projectId", "resourceUrl", "proxyPoolId",
  "connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy",
  "githubLogin", "githubName", "githubEmail", "githubUserId",
  "username", "firstName", "lastName", "authMethod", "authKind",
  "profileArn",
];

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 500;

function maskName(name: unknown): unknown {
  if (typeof name !== "string" || name.length <= 16) return name;
  if (/[a-zA-Z0-9_-]{32,}/.test(name)) return `${name.slice(0, 8)}***`;
  return name;
}

function sanitize(c: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const f of SAFE_FIELDS) if (c[f] !== undefined) safe[f] = c[f];
  if (safe.name) safe.name = maskName(safe.name);
  if (c.providerSpecificData) {
    const psd: Record<string, unknown> = {};
    for (const f of SAFE_PSD_FIELDS) {
      if ((c.providerSpecificData as Record<string, unknown>)[f] !== undefined) psd[f] = (c.providerSpecificData as Record<string, unknown>)[f];
    }
    safe.providerSpecificData = psd;
  }
  return safe;
}

function isUsageEligible(connection: Record<string, unknown>): boolean {
  return USAGE_SUPPORTED_PROVIDERS.includes(connection.provider as string) && (
    connection.authType === "oauth" || USAGE_APIKEY_PROVIDERS.includes(connection.provider as string)
  );
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sortConnections(connections: Record<string, unknown>[], sort: string): Record<string, unknown>[] {
  const list = [...connections];

  if (sort === "provider") {
    return list.sort((a, b) => {
      const orderA = USAGE_SUPPORTED_PROVIDERS.indexOf(a.provider as string);
      const orderB = USAGE_SUPPORTED_PROVIDERS.indexOf(b.provider as string);
      if (orderA !== orderB) return orderA - orderB;
      return (a.provider as string).localeCompare(b.provider as string);
    });
  }

  return list.sort((a, b) => {
    const priorityA = (a.priority as number) ?? Number.MAX_SAFE_INTEGER;
    const priorityB = (b.priority as number) ?? Number.MAX_SAFE_INTEGER;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return ((a.provider as string) || "").localeCompare((b.provider as string) || "");
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  try {
    await backfillCodexEmails();

    const provider = searchParams.get("provider") || "all";
    const accountStatus = searchParams.get("accountStatus") || "all";
    const sort = searchParams.get("sort") || "priority";
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = Math.min(parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

    const allConnections = await getProviderConnections();
    const quotaConnections = allConnections.filter(isUsageEligible);
    const usageStats = await getUsageStats("all");
    const configuredProviders = new Set(allConnections.map((connection) => connection.provider));
    const observedConnections = Object.keys(usageStats.byProvider)
      .filter((provider) => provider && !configuredProviders.has(provider))
      .map((provider) => ({
        id: `usage:${provider}`,
        provider,
        name: "Observed usage",
        isActive: true,
        authType: "usage",
        // No testStatus: these are synthetic rows for providers seen only in
        // usage history, never tested. The card keys off `usageOnly`.
        usageOnly: true,
      }));
    const eligibleConnections = [...quotaConnections, ...observedConnections];
    const providerOptions = Array.from(new Set(eligibleConnections.map((conn: Record<string, unknown>) => conn.provider))).sort();

    const providerFilteredConnections = eligibleConnections.filter((conn: Record<string, unknown>) => (
      provider === "all" || conn.provider === provider
    ));

    const accountFilteredConnections = providerFilteredConnections.filter((conn: Record<string, unknown>) => {
      if (accountStatus === "active") return conn.isActive ?? true;
      if (accountStatus === "inactive") return !(conn.isActive ?? true);
      return true;
    });

    const sortedConnections = sortConnections(accountFilteredConnections, sort);
    const total = sortedConnections.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;
    const pageConnections = sortedConnections.slice(offset, offset + pageSize).map(sanitize);

    return NextResponse.json({
      connections: pageConnections,
      providerOptions,
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
      totals: {
        eligibleConnections: eligibleConnections.length,
        providerFilteredConnections: providerFilteredConnections.length,
      },
    });
  } catch (error) {
    console.error("Error fetching providers for client:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
