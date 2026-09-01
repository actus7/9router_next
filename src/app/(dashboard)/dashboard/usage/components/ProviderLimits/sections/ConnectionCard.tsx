"use client";

import ProviderIcon from "@/shared/components/ProviderIcon";
import QuotaTable from "../QuotaTable";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import Card from "@/shared/components/Card";
import {
  filterQuotasByVisibility,
  getHiddenQuotaRows,
  getQuotaVisibilityKey,
  getConnectionLabel,
  type Connection,
  type QuotaData,
  type QuotaEntry,
} from "../utils";

const AUTO_PING_SETTINGS_KEYS: Record<string, string> = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};

const AUTO_PING_TOOLTIPS: Record<string, string> = {
  claude: "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.",
  codex: "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota.",
};
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  AlertCircle,
  Check,
  Clock,
  Copy,
  EyeOff,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Zap,
} from "lucide-react";
import { translate } from "@/i18n/runtime";

// Maps the stored providerSpecificData.authMethod to a human label for Kiro.
const KIRO_METHOD_LABELS: Record<string, string> = {
  "builder-id": "AWS Builder ID",
  idc: "IAM Identity Center",
  google: "Google",
  github: "GitHub",
  imported: "Imported Token",
  api_key: "API Key",
};

function kiroMethodLabel(conn: Connection) {
  const m = conn.providerSpecificData?.authMethod;
  if (typeof m === "string" && m in KIRO_METHOD_LABELS) return KIRO_METHOD_LABELS[m];
  return conn.authType === "api_key" ? "API Key" : "OAuth";
}

function getConnectionSecondaryLabel(connection: Connection) {
  if (connection.name?.trim() && connection.email?.trim() && connection.name.trim() !== connection.email.trim()) {
    return connection.email.trim();
  }

  if (connection.name?.trim() && connection.displayName?.trim() && connection.name.trim() !== connection.displayName.trim()) {
    return connection.displayName.trim();
  }

  return null;
}

function kiroRegion(conn: Connection): string {
  const r = conn.providerSpecificData?.region;
  if (typeof r === "string" && r) return r;
  const arn = conn.providerSpecificData?.profileArn;
  const seg = typeof arn === "string" ? arn.split(":")[3] : "";
  return seg || "";
}

function getCodexResetCreditCount(quota: QuotaData | undefined) {
  const resetCredits = quota?.raw?.resetCredits as Record<string, unknown> | undefined;
  const value = resetCredits?.availableCount;
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

interface ConnectionCardProps {
  conn: Connection;
  quota: QuotaData | undefined;
  isLoading: boolean;
  error: string | null;
  quotaSortMode: string;
  quotaVisibility: Record<string, { hidden?: string[] }>;
  autoPingMaps: Record<string, Record<string, boolean>>;
  deletingId: string | null;
  togglingId: string | null;
  resettingLimitId: string | null;
  refreshProvider: (connectionId: string, provider: string) => Promise<void>;
  toggleAutoPing: (connectionId: string, provider: string, on: boolean) => Promise<void>;
  handleHideQuota: (provider: string, quota: QuotaEntry) => void;
  handleShowQuota: (provider: string, quota: QuotaEntry) => void;
  handleToggleConnectionActive: (id: string, isActive: boolean) => Promise<void>;
  setSelectedConnection: React.Dispatch<React.SetStateAction<Connection | null>>;
  setShowEditModal: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingDeleteId: React.Dispatch<React.SetStateAction<string | null>>;
  setShowDeleteConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  setResetConfirmState: React.Dispatch<React.SetStateAction<{ connection: Connection; resetCreditCount: number } | null>>;
  handleViewCodexResetCredits: (connection: Connection) => Promise<void>;
}

export default function ConnectionCard({
  conn,
  quota,
  isLoading,
  error,
  quotaSortMode,
  quotaVisibility,
  autoPingMaps,
  deletingId,
  togglingId,
  resettingLimitId,
  refreshProvider,
  toggleAutoPing,
  handleHideQuota,
  handleShowQuota,
  handleToggleConnectionActive,
  setSelectedConnection,
  setShowEditModal,
  setPendingDeleteId,
  setShowDeleteConfirm,
  setResetConfirmState,
  handleViewCodexResetCredits,
}: ConnectionCardProps) {
  const { copied, copy } = useCopyToClipboard();

  const isInactive = conn.isActive === false;
  const isCodex = conn.provider === "codex";
  const resetCreditCount = getCodexResetCreditCount(quota);
  const isResettingLimit = resettingLimitId === conn.id;
  const rowBusy = deletingId === conn.id || togglingId === conn.id || isResettingLimit;
  const rawQuotas = quota?.quotas || [];
  const visibleQuotas = filterQuotasByVisibility(conn.provider, rawQuotas, quotaVisibility);
  const hiddenQuotaRows = getHiddenQuotaRows(conn.provider, rawQuotas, quotaVisibility);

  return (
    <Card
      key={conn.id}
      padding="none"
      className={`min-w-0 ${isInactive ? "opacity-60" : ""}`}
    >
      <div className="px-3 py-2 border-b border-black/10 dark:border-white/10">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center overflow-hidden">
              <ProviderIcon
                src={`/providers/${conn.provider}.png`}
                alt={conn.provider}
                size={32}
                className="object-contain"
                fallbackText={
                  conn.provider?.slice(0, 2).toUpperCase() || "PR"
                }
              />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text-primary capitalize truncate">
                {conn.provider}
              </h3>
              {getConnectionLabel(conn) ? (
                <p className="text-xs text-text-muted truncate">
                  {getConnectionLabel(conn)}
                </p>
              ) : null}
              {getConnectionSecondaryLabel(conn) ? (
                <p className="text-[11px] text-text-muted/80 truncate">
                  {getConnectionSecondaryLabel(conn)}
                </p>
              ) : null}
              {conn.provider === "kiro" && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-600 dark:text-brand-300">
                    {kiroMethodLabel(conn)}
                  </span>
                  {kiroRegion(conn) && (
                    <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                      {kiroRegion(conn)}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      isInactive
                        ? "bg-surface-2 text-text-muted"
                        : conn.testStatus === "active" || conn.testStatus === "success"
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : conn.testStatus === "error" || conn.testStatus === "expired" || conn.testStatus === "unavailable"
                            ? "bg-red-500/10 text-red-600 dark:text-red-400"
                            : "bg-surface-2 text-text-muted"
                    }`}
                  >
                    {isInactive ? "disabled" : conn.testStatus || "unknown"}
                  </span>
                  {typeof conn.providerSpecificData?.profileArn === "string" && conn.providerSpecificData.profileArn && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => copy(conn.providerSpecificData!.profileArn as string, conn.id)}
                      title={conn.providerSpecificData!.profileArn as string}
                      className="max-w-full gap-1 rounded-full border border-border-subtle px-2 py-0.5 text-[10px] text-text-muted hover:text-primary"
                    >
                      {copied === conn.id ? <Check className="size-3" /> : <Copy className="size-3" />}
                      <code className="truncate font-mono">
                        {conn.providerSpecificData!.profileArn as string}
                      </code>
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isCodex && (
              <>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setResetConfirmState({ connection: conn, resetCreditCount })}
                        disabled={resetCreditCount <= 0 || isLoading || rowBusy}
                        aria-label={
                          resetCreditCount > 0
                            ? `Use one Codex reset credit. ${resetCreditCount} available.`
                            : "No Codex reset credits available"
                        }
                        className={`min-w-10 gap-1 text-[11px] font-medium tabular-nums ${
                          resetCreditCount > 0
                            ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                            : ""
                        }`}
                      >
                        {isResettingLimit ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                        <span>{resetCreditCount}</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{resetCreditCount > 0 ? `Use one Codex reset credit. Available: ${resetCreditCount}` : "No Codex reset credits available"}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => handleViewCodexResetCredits(conn)}
                        disabled={isLoading || rowBusy}
                        aria-label="View Codex reset credit expiry"
                      >
                        <Clock className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>View Codex reset credit expiry</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
            {AUTO_PING_SETTINGS_KEYS[conn.provider] && conn.authType === "oauth" && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex" />}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleAutoPing(conn.id, conn.provider, !(autoPingMaps[conn.provider]?.[conn.id] === true))}
                      aria-label="Toggle auto-ping"
                      className={autoPingMaps[conn.provider]?.[conn.id] === true ? "text-primary" : "text-text-muted"}
                    >
                      <Zap className="size-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{AUTO_PING_TOOLTIPS[conn.provider]}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => refreshProvider(conn.id, conn.provider)}
                    disabled={isLoading || rowBusy}
                    aria-label="Refresh quota"
                  >
                    <RefreshCw className={`size-[18px] text-text-muted ${isLoading ? "animate-spin" : ""}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh quota</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setSelectedConnection(conn);
                      setShowEditModal(true);
                    }}
                    disabled={rowBusy}
                    aria-label="Edit connection"
                    className="text-text-muted hover:text-primary"
                  >
                    <Pencil className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit connection</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    onClick={() => {
                      setPendingDeleteId(conn.id);
                      setShowDeleteConfirm(true);
                    }}
                    disabled={rowBusy}
                    aria-label="Delete connection"
                  >
                    <Trash2 className={`size-[18px] ${deletingId === conn.id ? "animate-pulse" : ""}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete connection</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div
              className="inline-flex items-center pl-0.5"
              title={
                (conn.isActive ?? true)
                  ? "Disable connection"
                  : "Enable connection"
              }
            >
              <Switch
                size="sm"
                checked={conn.isActive ?? true}
                disabled={rowBusy}
                onCheckedChange={(nextActive) =>
                  handleToggleConnectionActive(conn.id, nextActive)
                }
              />
            </div>
          </div>
        </div>
      </div>

      <div className="px-2 py-1.5">
        {isLoading ? (
          <div className="text-center py-5 text-text-muted">
            <Loader2 className="size-7" />
          </div>
        ) : error ? (
          <div className="text-center py-5">
            <AlertCircle className="size-7" />
            <p className="mt-1.5 text-xs text-text-muted">{error}</p>
          </div>
        ) : quota?.message ? (
          <div className="text-center py-5">
            <p className="text-xs text-text-muted">{quota.message}</p>
          </div>
        ) : (
          <QuotaTable
            quotas={visibleQuotas}
            compact
            sortMode="default"
            showSortLabel={
              conn.provider === "codex" && quotaSortMode !== "default"
            }
            onHideQuota={(quotaRow) => handleHideQuota(conn.provider, quotaRow)}
          />
        )}
        {hiddenQuotaRows.length > 0 && (
          <div className="mt-2 flex min-w-0 items-center gap-1 border-t border-black/5 pt-2 text-[10px] text-text-muted dark:border-white/5">
            <EyeOff className="size-4" />
            <span className="shrink-0">{translate("Hidden:") || "Hidden:"}</span>
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap pb-2">
              {hiddenQuotaRows.map((quotaRow) => (
                <Button
                  key={getQuotaVisibilityKey(quotaRow)}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => handleShowQuota(conn.provider, quotaRow)}
                  className="shrink-0 rounded-md px-1.5 py-0.5"
                  title="Show this quota row"
                >
                  {quotaRow.name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
