import { Badge } from "@/components/ui/badge";
import { getErrorCode, getRelativeTime } from "@/shared/utils";
import { getProviderAvailability } from "@/shared/constants/providers";
import { translate } from "@/i18n/runtime";
import type { Connection, ProviderInfo, ProviderStats, Availability, AvailabilityFilter } from "../types";

export function getStatusDisplay(connected: number, error: number, errorCode: string | null) {
  const parts = [];
  if (connected > 0) {
    parts.push(
      <Badge key="connected" variant="success">
        {connected} {translate("Connected")}
      </Badge>,
    );
  }
  if (error > 0) {
    const errText = errorCode
      ? `${error} Error (${errorCode})`
      : `${error} Error`;
    parts.push(
      <Badge key="error" variant="destructive">
        {errText}
      </Badge>,
    );
  }
  if (parts.length === 0) {
    return <span className="text-text-muted">{translate("No connections")}</span>;
  }
  return parts;
}

export function getConnectionErrorTag(connection: Connection) {
  if (!connection) return null;

  const explicitType = connection.lastErrorType;
  if (explicitType === "runtime_error") return "RUNTIME";
  if (
    explicitType === "upstream_auth_error" ||
    explicitType === "auth_missing" ||
    explicitType === "token_refresh_failed" ||
    explicitType === "token_expired"
  )
    return "AUTH";
  if (explicitType === "upstream_rate_limited") return "429";
  if (explicitType === "upstream_unavailable") return "5XX";
  if (explicitType === "network_error") return "NET";

  const numericCode = Number(connection.errorCode);
  if (Number.isFinite(numericCode) && numericCode >= 400)
    return String(numericCode);

  const fromMessage = getErrorCode(connection.lastError);
  if (fromMessage === "401" || fromMessage === "403") return "AUTH";
  if (fromMessage && fromMessage !== "ERR") return fromMessage;

  const msg = (connection.lastError || "").toLowerCase();
  if (
    msg.includes("runtime") ||
    msg.includes("not runnable") ||
    msg.includes("not installed")
  )
    return "RUNTIME";
  if (
    msg.includes("invalid api key") ||
    msg.includes("token invalid") ||
    msg.includes("revoked") ||
    msg.includes("unauthorized")
  )
    return "AUTH";

  return "ERR";
}

export function getProviderStats(
  connections: Connection[],
  providerId: string,
  authType: string | string[],
  normalizeProviderId: (id: string) => string,
): ProviderStats {
  const authTypes = Array.isArray(authType) ? authType : [authType];
  const providerConnections = connections.filter(
    (c) => normalizeProviderId(c.provider) === providerId && authTypes.includes(c.authType || ""),
  );

  const getEffectiveStatus = (conn: Connection) => conn.testStatus;

  const connected = providerConnections.filter((c) => {
    const status = getEffectiveStatus(c);
    return status === "active" || status === "success";
  }).length;

  const errorConns = providerConnections.filter((c) => {
    const status = getEffectiveStatus(c);
    return (
      status === "error" || status === "expired" || status === "unavailable"
    );
  });

  const error = errorConns.length;
  const total = providerConnections.length;
  const allDisabled =
    total > 0 && providerConnections.every((c) => c.isActive === false);

  const latestError = errorConns.sort(
    (a, b) => new Date(b.lastErrorAt || 0).getTime() - new Date(a.lastErrorAt || 0).getTime(),
  )[0];
  const errorCode = latestError ? getConnectionErrorTag(latestError) : null;
  const errorTime = latestError?.lastErrorAt
    ? getRelativeTime(latestError.lastErrorAt)
    : null;

  return { connected, error, total, errorCode, errorTime, allDisabled };
}

export function availabilityFor(provider: ProviderInfo): Availability {
  const availability = getProviderAvailability(provider);
  return availability === "paid" ? null : availability;
}

export function matchSearch(searchQuery: string, name: string): boolean {
  return (
    !searchQuery.trim() ||
    name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );
}

export function sortByPriority(
  entries: [string, ProviderInfo][],
  authType: string | string[],
  getStats: (id: string, auth: string | string[]) => ProviderStats,
): [string, ProviderInfo][] {
  return [...entries].sort(([ka, a], [kb, b]) => {
    const pa = a.priority ?? 999;
    const pb = b.priority ?? 999;
    if (pa !== pb) return pa - pb;
    const sa = getStats(ka, authType);
    const sb = getStats(kb, authType);
    const ca = sa.connected > 0 ? 1 : 0;
    const cb = sb.connected > 0 ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return (a.name || "").localeCompare(b.name || "");
  });
}

export function filterByAvailability(
  entries: [string, ProviderInfo][],
  _source: "free" | "freeTier" | "other",
  authTypes: string | string[],
  availabilityFilter: AvailabilityFilter,
  getStats: (id: string, auth: string | string[]) => ProviderStats,
): [string, ProviderInfo][] {
  return entries.filter(([key, provider]) => {
    const avail = availabilityFor(provider);
    const stats = getStats(key, authTypes);
    if (availabilityFilter === "free") return avail !== null;
    if (availabilityFilter === "connected") return stats.connected > 0;
    return true;
  });
}
