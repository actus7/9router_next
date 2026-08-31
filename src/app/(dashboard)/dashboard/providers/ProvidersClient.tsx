"use client";

import { useState, useEffect } from "react";
import {
  Card,
  Button,
  Modal,
} from "@/shared/components";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import Link from "next/link";
import { getErrorCode, getRelativeTime } from "@/shared/utils";
import { useNotificationStore } from "@/store/notificationStore";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import ModelAvailabilityBadge from "./components/ModelAvailabilityBadge";
import AddCompatibleModal from "./components/AddCompatibleModal";
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, PauseCircle, Play, Plus, Puzzle, SearchX } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface Connection {
  id: string;
  provider: string;
  authType?: string;
  isActive?: boolean;
  testStatus?: string;
  lastError?: string;
  lastErrorAt?: string;
  lastErrorType?: string;
  errorCode?: string;
  [key: string]: unknown;
}

interface ProviderNode {
  id: string;
  name?: string;
  type?: string;
  apiType?: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  color?: string;
  textIcon?: string;
  icon?: string;
  noAuth?: boolean;
  hidden?: boolean;
  priority?: number;
  authModes?: string[];
  serviceKinds?: string[];
  apiType?: string;
}

interface ProviderStats {
  connected: number;
  error: number;
  total: number;
  errorCode: string | null;
  errorTime: string | null;
  allDisabled: boolean;
}

interface TestResult {
  connectionId?: string;
  connectionName?: string;
  provider?: string;
  valid?: boolean;
  latencyMs?: number;
  diagnosis?: { type?: string };
}

interface TestResults {
  mode?: string;
  results?: TestResult[];
  summary?: { total: number; passed: number; failed: number };
  error?: string;
}

interface ProvidersClientProps {
  initialConnections: Connection[];
  initialNodes: ProviderNode[];
}

function getStatusDisplay(connected: number, error: number, errorCode: string | null) {
  const parts = [];
  if (connected > 0) {
    parts.push(
      <Badge key="connected" variant="default" className="bg-green-500/10 text-green-600 dark:text-green-400">
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

function getConnectionErrorTag(connection: Connection) {
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

const APIKEY_INITIAL_VISIBLE = 20;

export default function ProvidersClient({ initialConnections, initialNodes }: ProvidersClientProps) {
  const [connections, setConnections] = useState<Connection[]>(initialConnections);
  const [providerNodes, setProviderNodes] = useState<ProviderNode[]>(initialNodes);
  const [loading, setLoading] = useState(false);
  const [showAllApikey, setShowAllApikey] = useState(false);
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] =
    useState(false);
  const [testingMode, setTestingMode] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResults | null>(null);
  const notify = useNotificationStore();
  const searchQuery = useHeaderSearchStore((s) => s.query);
  const registerSearch = useHeaderSearchStore((s) => s.register);
  const unregisterSearch = useHeaderSearchStore((s) => s.unregister);

  useEffect(() => {
    registerSearch(translate("Search providers...") || "Search providers...");
    return () => unregisterSearch();
  }, [registerSearch, unregisterSearch]);

  const matchSearch = (name: string) =>
    !searchQuery.trim() ||
    name.toLowerCase().includes(searchQuery.trim().toLowerCase());

  const sortByPriority = (entries: [string, ProviderInfo][], authType: string | string[]) =>
    [...entries].sort(([ka, a], [kb, b]) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const sa = getProviderStats(ka, authType);
      const sb = getProviderStats(kb, authType);
      const ca = sa.connected > 0 ? 1 : 0;
      const cb = sb.connected > 0 ? 1 : 0;
      if (ca !== cb) return cb - ca;
      return (a.name || "").localeCompare(b.name || "");
    });

  const getProviderStats = (providerId: string, authType: string | string[]): ProviderStats => {
    const authTypes = Array.isArray(authType) ? authType : [authType];
    const providerConnections = connections.filter(
      (c) => c.provider === providerId && authTypes.includes(c.authType || ""),
    );

    const getEffectiveStatus = (conn: Connection) => {
      const isCooldown = Object.entries(conn).some(
        ([k, v]) =>
          k.startsWith("modelLock_") && v && new Date(v as string).getTime() > Date.now(),
      );
      return conn.testStatus === "unavailable" && !isCooldown
        ? "active"
        : conn.testStatus;
    };

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
  };

  const handleToggleProvider = async (providerId: string, authType: string | string[], newActive: boolean) => {
    const authTypes = Array.isArray(authType) ? authType : [authType];
    const matches = (c: Connection) =>
      c.provider === providerId && authTypes.includes(c.authType || "");
    const providerConns = connections.filter(matches);
    setConnections((prev) =>
      prev.map((c) => (matches(c) ? { ...c, isActive: newActive } : c)),
    );
    await Promise.allSettled(
      providerConns.map((c) =>
        fetch(`/api/providers/${c.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: newActive }),
        }),
      ),
    );
  };

  const handleBatchTest = async (mode: string, providerId: string | null = null) => {
    if (testingMode) return;
    setTestingMode(mode === "provider" ? providerId : mode);
    setTestResults(null);
    try {
      const res = await fetch("/api/providers/test-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, providerId }),
      });
      const data = await res.json();
      setTestResults(data);
      if (data.summary) {
        const { passed, failed, total } = data.summary;
        if (failed === 0) notify.success(translate("All") + ` ${total} ` + translate("tests passed"));
        else notify.warning(`${passed}/${total} ` + translate("passed") + `, ${failed} ` + translate("failed"));
      }
    } catch (error) {
      setTestResults({ error: translate("Test request failed") || "Test request failed" });
      notify.error(translate("Provider test failed") || "Provider test failed");
    } finally {
      setTestingMode(null);
    }
  };

  const compatibleProviders = providerNodes
    .filter((node) => node.type === "openai-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "OpenAI Compatible",
      color: "#10A37F",
      textIcon: "OC",
      apiType: node.apiType,
    }))
    .filter((p) => matchSearch(p.name));

  const anthropicCompatibleProviders = providerNodes
    .filter((node) => node.type === "anthropic-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "Anthropic Compatible",
      color: "#D97757",
      textIcon: "AC",
    }))
    .filter((p) => matchSearch(p.name));

  const dualAuthTypes = (info: ProviderInfo, key: string): string | string[] => {
    if (key === "kiro") return ["oauth", "apikey", "api_key"];
    const modes = info?.authModes;
    if (!Array.isArray(modes)) {
      return key in FREE_TIER_PROVIDERS || key in APIKEY_PROVIDERS
        ? ["oauth", "apikey", "api_key"]
        : "oauth";
    }
    if (!modes.includes("apikey")) return "oauth";
    return ["oauth", "apikey", "api_key"];
  };

  const oauthEntries = sortByPriority(
    (Object.entries(OAUTH_PROVIDERS) as unknown as [string, ProviderInfo][]).filter(([, info]) => !info.hidden && matchSearch(info.name)),
    "oauth",
  );
  const freeEntries = (Object.entries(FREE_PROVIDERS) as unknown as [string, ProviderInfo][])
    .filter(([, info]) => !info.hidden && matchSearch(info.name))
    .sort(([, a], [, b]) => (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0));
  const freeTierEntries = (Object.entries(FREE_TIER_PROVIDERS) as unknown as [string, ProviderInfo][])
    .filter(
      ([, info]) =>
        !info.hidden &&
        matchSearch(info.name) &&
        (info.serviceKinds ?? ["llm"]).includes("llm"),
    )
    .sort(([ka, a], [kb, b]) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const noAuthDiff = (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0);
      if (noAuthDiff !== 0) return noAuthDiff;
      const ca = getProviderStats(ka, dualAuthTypes(a, ka)).connected > 0 ? 0 : 1;
      const cb = getProviderStats(kb, dualAuthTypes(b, kb)).connected > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });
  const apikeyEntries = (Object.entries(APIKEY_PROVIDERS) as unknown as [string, ProviderInfo][])
    .filter(
      ([, info]) =>
        !info.hidden &&
        (info.serviceKinds ?? ["llm"]).includes("llm") &&
        matchSearch(info.name),
    )
    .sort(([ka, a], [kb, b]) => {
      const ca = getProviderStats(ka, "apikey").total > 0 ? 0 : 1;
      const cb = getProviderStats(kb, "apikey").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });
  const isApikeySearching = !!searchQuery.trim();
  const visibleApikeyEntries =
    isApikeySearching || showAllApikey
      ? apikeyEntries
      : apikeyEntries.slice(0, APIKEY_INITIAL_VISIBLE);
  const hiddenApikeyCount = apikeyEntries.length - APIKEY_INITIAL_VISIBLE;

  const webCookieEntries = (Object.entries(WEB_COOKIE_PROVIDERS) as unknown as [string, ProviderInfo][])
    .filter(([, info]) => !info.hidden && matchSearch(info.name))
    .sort(([ka, a], [kb, b]) => {
      const ca = getProviderStats(ka, "cookie").total > 0 ? 0 : 1;
      const cb = getProviderStats(kb, "cookie").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });

  const hasAnyResult =
    oauthEntries.length > 0 ||
    freeEntries.length > 0 ||
    freeTierEntries.length > 0 ||
    apikeyEntries.length > 0 ||
    webCookieEntries.length > 0 ||
    compatibleProviders.length > 0 ||
    anthropicCompatibleProviders.length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {!hasAnyResult && (
        <div className="text-center py-8 border border-dashed border-border rounded-xl">
          <SearchX className="size-8" />
          <p className="text-text-muted text-sm">{translate("No providers match your search")}</p>
        </div>
      )}

      {/* Custom Providers (OpenAI/Anthropic Compatible) — dynamic */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            {translate("Custom Providers (OpenAI/Anthropic Compatible)")}{" "}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:w-auto">
            <Button
              icon={<Plus className="size-4" />}
              onClick={() => setShowAddAnthropicCompatibleModal(true)}
              className="w-full sm:w-auto"
            >
              {translate("Add Anthropic Compatible")}
            </Button>
            <Button
              variant="outline"
              icon={<Plus className="size-4" />}
              onClick={() => setShowAddCompatibleModal(true)}
              className="w-full sm:w-auto"
            >
              {translate("Add OpenAI Compatible")}
            </Button>
          </div>
        </div>
        {compatibleProviders.length === 0 &&
        anthropicCompatibleProviders.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-2 border border-dashed border-border rounded-xl text-text-muted text-sm">
            <Puzzle className="size-5" />
            <span>{translate("No custom providers — use the buttons above to add OpenAI/Anthropic compatible endpoints")}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {[...compatibleProviders, ...anthropicCompatibleProviders].map(
              (info) => (
                <ApiKeyProviderCard
                  key={info.id}
                  providerId={info.id}
                  provider={info}
                  stats={getProviderStats(info.id, "apikey")}
                  onToggle={(active) =>
                    handleToggleProvider(info.id, "apikey", active)
                  }
                />
              ),
            )}
          </div>
        )}
      </div>

      {/* OAuth Providers */}
      {oauthEntries.length > 0 && (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            {translate("OAuth Providers")}
          </h2>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <ModelAvailabilityBadge />
            <Button
              variant="outline"
              onClick={() => handleBatchTest("oauth")}
              disabled={!!testingMode}
              className={testingMode === "oauth" ? "animate-pulse" : ""}
              title={translate("Test all OAuth connections") || "Test all OAuth connections"}
              aria-label={translate("Test all OAuth connections") || "Test all OAuth connections"}
            >
              <span
                className={`text-[14px]${testingMode === "oauth" ? " animate-spin" : ""}`}
              >
                <Play className="size-3.5" />
              </span>
              {testingMode === "oauth" ? translate("Testing...") : translate("Test All")}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {oauthEntries.map(([key, info]) => {
            const authTypes = dualAuthTypes(info, key);
            return (
              <ProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, authTypes)}
                onToggle={(active) => handleToggleProvider(key, authTypes, active)}
              />
            );
          })}
        </div>
      </div>
      )}

      {/* Free Tier Providers */}
      {(freeEntries.length > 0 || freeTierEntries.length > 0) && (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            {translate("Free Tier Providers")}
          </h2>
          <Button
            variant="outline"
            onClick={() => handleBatchTest("free")}
            disabled={!!testingMode}
            className={testingMode === "free" ? "animate-pulse" : ""}
            title={translate("Test all Free connections") || "Test all Free connections"}
            aria-label={translate("Test all Free provider connections") || "Test all Free provider connections"}
          >
            <span
              className={`text-[14px]${testingMode === "free" ? " animate-spin" : ""}`}
            >
              <Play className="size-3.5" />
            </span>
            {testingMode === "free" ? translate("Testing...") : translate("Test All")}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {freeEntries.map(([key, info]) => {
            const freeAuthTypes = dualAuthTypes(info, key);
            return (
              <ProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, freeAuthTypes)}
                onToggle={(active) =>
                  handleToggleProvider(key, freeAuthTypes, active)
                }
              />
            );
          })}
          {freeTierEntries.map(([key, info]) => {
            const freeAuthTypes = dualAuthTypes(info, key);
            return (
              <ApiKeyProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, freeAuthTypes)}
                onToggle={(active) => handleToggleProvider(key, freeAuthTypes, active)}
              />
            );
          })}
        </div>
      </div>
      )}

      {/* API Key Providers — fixed list */}
      {apikeyEntries.length > 0 && (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            {translate("API Key Providers")}{" "}
          </h2>
          <Button
            variant="outline"
            onClick={() => handleBatchTest("apikey")}
            disabled={!!testingMode}
            className={testingMode === "apikey" ? "animate-pulse" : ""}
            title={translate("Test all API Key connections") || "Test all API Key connections"}
            aria-label={translate("Test all API Key connections") || "Test all API Key connections"}
          >
            <span
              className={`text-[14px]${testingMode === "apikey" ? " animate-spin" : ""}`}
            >
              <Play className="size-3.5" />
            </span>
            {testingMode === "apikey" ? translate("Testing...") : translate("Test All")}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {visibleApikeyEntries.map(([key, info]) => (
            <ApiKeyProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "apikey")}
              onToggle={(active) => handleToggleProvider(key, "apikey", active)}
            />
          ))}
        </div>
        {!isApikeySearching && !showAllApikey && hiddenApikeyCount > 0 && (
          <Button
            variant="outline"
            onClick={() => setShowAllApikey(true)}
            className="w-full border-dashed border-primary/40 text-primary hover:border-primary hover:bg-primary/5"
          >
            <ChevronDown className="size-4" />
            {translate("Show all")} {apikeyEntries.length} {translate("providers")}
          </Button>
        )}
      </div>
      )}

      {/* Web Session Providers (cookie-based auth) */}
      {webCookieEntries.length > 0 && (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            {translate("Web Session Providers")}
          </h2>
          <Button
            variant="outline"
            onClick={() => handleBatchTest("cookie")}
            disabled={!!testingMode}
            className={testingMode === "cookie" ? "animate-pulse" : ""}
            title={translate("Test all Web Session connections") || "Test all Web Session connections"}
            aria-label={translate("Test all Web Session connections") || "Test all Web Session connections"}
          >
            <span
              className={`text-[14px]${testingMode === "cookie" ? " animate-spin" : ""}`}
            >
              <Play className="size-3.5" />
            </span>
            {testingMode === "cookie" ? translate("Testing...") : translate("Test All")}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {webCookieEntries.map(([key, info]) => (
            <ApiKeyProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "cookie")}
              onToggle={(active) => handleToggleProvider(key, "cookie", active)}
            />
          ))}
        </div>
      </div>
      )}

      <AddCompatibleModal
        variant="openai"
        isOpen={showAddCompatibleModal}
        onClose={() => setShowAddCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node as unknown as ProviderNode]);
          setShowAddCompatibleModal(false);
        }}
      />
      <AddCompatibleModal
        variant="anthropic"
        isOpen={showAddAnthropicCompatibleModal}
        onClose={() => setShowAddAnthropicCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node as unknown as ProviderNode]);
          setShowAddAnthropicCompatibleModal(false);
        }}
      />

      {/* Test Results Modal */}
      <Modal
        isOpen={!!testResults}
        onClose={() => setTestResults(null)}
        title={translate("Test Results") || "Test Results"}
        size="full"
      >
        {testResults && <ProviderTestResultsView results={testResults} />}
      </Modal>
    </div>
  );
}

function ProviderCard({ providerId, provider, stats, onToggle }: {
  providerId: string;
  provider: ProviderInfo;
  stats: ProviderStats;
  onToggle: (active: boolean) => void;
}) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isNoAuth = !!provider.noAuth;

  return (
    <Link href={`/dashboard/providers/${providerId}`} className="group min-w-0">
      <Card
        padding="xs"
        className={`h-full hover:bg-surface-2/30 transition-colors cursor-pointer ${allDisabled ? "opacity-50" : ""}`}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="size-8 shrink-0 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: `${(provider.color?.length ?? 0) > 7 ? provider.color : provider.color + "15"}`,
              }}
            >
              <ProviderIcon
                src={`/providers/${provider.id}.png`}
                alt={provider.name}
                size={30}
                className="object-contain rounded-lg max-w-[32px] max-h-[32px]"
                fallbackText={
                  provider.textIcon || provider.id.slice(0, 2).toUpperCase()
                }
                fallbackColor={provider.color}
              />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-semibold">{provider.name}</h3>
              <div className="flex min-w-0 items-center gap-1.5 text-xs flex-wrap">
                {allDisabled ? (
                  <Badge variant="default" >
                    <span className="flex items-center gap-1">
                      <PauseCircle className="size-3" />
                      {translate("Disabled")}
                    </span>
                  </Badge>
                ) : isNoAuth ? (
                  <Badge variant="default" className="bg-green-500/10 text-green-600 dark:text-green-400">{translate("Ready")}</Badge>
                ) : (
                  <>
                    {getStatusDisplay(connected, error, errorCode)}
                    {errorTime && (
                      <span className="text-text-muted">{errorTime}</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {stats.total > 0 && (
              <div
                className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle(!allDisabled ? false : true);
                }}
              >
                <Switch
                  checked={!allDisabled}
                  onCheckedChange={() => {}}
                  title={allDisabled ? translate("Enable provider") ?? undefined : translate("Disable provider") ?? undefined}
                />
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function ApiKeyProviderCard({
  providerId,
  provider,
  stats,
  onToggle,
}: {
  providerId: string;
  provider: ProviderInfo & { apiType?: string };
  stats: ProviderStats;
  onToggle: (active: boolean) => void;
}) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(
    ANTHROPIC_COMPATIBLE_PREFIX,
  );

  const getIconPath = () => {
    if (isCompatible && provider.apiType)
      return provider.apiType === "responses"
        ? "/providers/oai-r.png"
        : "/providers/oai-cc.png";
    if (isAnthropicCompatible) return "/providers/anthropic-m.png";
    return getProviderIconSrc(provider.id);
  };

  return (
    <Link href={`/dashboard/providers/${providerId}`} className="group min-w-0">
      <Card
        padding="xs"
        className={`h-full hover:bg-surface-2/30 transition-colors cursor-pointer ${allDisabled ? "opacity-50" : ""}`}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="size-8 shrink-0 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: `${(provider.color?.length ?? 0) > 7 ? provider.color : provider.color + "15"}`,
              }}
            >
              <ProviderIcon
                src={getIconPath()}
                alt={provider.name}
                size={30}
                className="object-contain rounded-lg max-w-[30px] max-h-[30px]"
                fallbackText={
                  provider.textIcon || provider.id.slice(0, 2).toUpperCase()
                }
                fallbackColor={provider.color}
              />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-semibold">{provider.name}</h3>
              <div className="flex min-w-0 items-center gap-1.5 text-xs flex-wrap">
                {allDisabled ? (
                  <Badge variant="default" >
                    <span className="flex items-center gap-1">
                      <PauseCircle className="size-3" />
                      {translate("Disabled")}
                    </span>
                  </Badge>
                ) : (
                  <>
                    {getStatusDisplay(connected, error, errorCode)}
                    {isCompatible && (
                      <Badge variant="default" >
                        {provider.apiType === "responses"
                          ? "Responses"
                          : "Chat"}
                      </Badge>
                    )}
                    {isAnthropicCompatible && (
                      <Badge variant="default" >
                        Messages
                      </Badge>
                    )}
                    {errorTime && (
                      <span className="text-text-muted">{errorTime}</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {stats.total > 0 && (
              <div
                className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle(!allDisabled ? false : true);
                }}
              >
                <Switch
                  checked={!allDisabled}
                  onCheckedChange={() => {}}
                  title={allDisabled ? translate("Enable provider") ?? undefined : translate("Disable provider") ?? undefined}
                />
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function ProviderTestResultsView({ results }: { results: TestResults }) {
  if (results.error && !results.results) {
    return (
      <div className="text-center py-6">
        <AlertCircle className="size-8" />
        <p className="text-sm text-red-400">{results.error}</p>
      </div>
    );
  }

  const { summary, mode } = results;
  const items = results.results || [];
  const modeLabel =
    ({
      oauth: "OAuth",
      free: "Free",
      apikey: "API Key",
      cookie: "Web Session",
      provider: "Provider",
      all: "All",
    } as Record<string, string>)[mode || ""] || mode;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {summary && (
        <div className="flex flex-wrap items-center gap-2 text-xs mb-1 sm:gap-3">
          <span className="text-text-muted">{modeLabel} Test</span>
          <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">
            {summary.passed} {translate("passed")}
          </span>
          {summary.failed > 0 && (
            <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400 font-medium">
              {summary.failed} {translate("failed")}
            </span>
          )}
          <span className="text-text-muted sm:ml-auto">
            {summary.total} {translate("tested")}
          </span>
        </div>
      )}
      {items.map((r, i) => (
        <div
          key={r.connectionId || i}
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-black/[0.03] px-3 py-2 text-xs dark:bg-white/[0.03] sm:flex-nowrap"
        >
          <span
            className={`text-[16px] ${r.valid ? "text-emerald-500" : "text-red-500"}`}
          >
            {r.valid ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
          </span>
          <div className="min-w-0 flex-[1_1_160px]">
            <span className="block truncate font-medium sm:inline">
              {r.connectionName}
            </span>
            <span className="block truncate text-text-muted sm:ml-1.5 sm:inline">
              ({r.provider})
            </span>
          </div>
          {r.latencyMs !== undefined && (
            <span className="shrink-0 text-text-muted font-mono tabular-nums">
              {r.latencyMs}ms
            </span>
          )}
          <span
            className={`shrink-0 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
              r.valid
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-red-500/15 text-red-400"
            }`}
          >
            {r.valid ? "OK" : r.diagnosis?.type || "ERROR"}
          </span>
        </div>
      ))}
      {items.length === 0 && (
        <div className="text-center py-4 text-text-muted text-sm">
          {translate("No active connections found for this group.")}
        </div>
      )}
    </div>
  );
}
