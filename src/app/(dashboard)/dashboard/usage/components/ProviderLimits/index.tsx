"use client";

import { useEffect, useMemo } from "react";
import Card from "@/shared/components/Card";
import {
  sortVisibleConnections,
  buildLoadingState,
  filterQuotaStateByConnections,
  getConnectionsEmptyMessage,
  calculatePercentage,
  DEPLETED_QUOTA_THRESHOLD,
  type Connection,
  type QuotaEntry,
} from "./utils";
import { translate } from "@/i18n/runtime";
import { CloudOff, AlertCircle, LayoutGrid } from "lucide-react";

import { useConnections } from "./hooks/useConnections";
import { useQuotaData } from "./hooks/useQuotaData";
import { useConnectionActions } from "./hooks/useConnectionActions";
import { useCodexReset } from "./hooks/useCodexReset";
import { useSettings } from "./hooks/useSettings";

import ToolbarSection from "./sections/ToolbarSection";
import ConnectionCard from "./sections/ConnectionCard";
import PaginationSection from "./sections/PaginationSection";
import ModalsSection from "./sections/ModalsSection";

const EMPTY_STATE_ICON_MAP: Record<string, React.ElementType> = {
  cloud_off: CloudOff,
  search_off: AlertCircle,
  search: LayoutGrid,
  warning: AlertCircle,
  error: AlertCircle,
  info: AlertCircle,
};

export default function ProviderLimits() {
  const connectionsHook = useConnections();
  const quotaHook = useQuotaData(connectionsHook.fetchConnections, connectionsHook.page);
  const actionsHook = useConnectionActions(
    connectionsHook.fetchConnections,
    quotaHook.fetchQuota,
    connectionsHook.page,
    quotaHook.setQuotaData,
    quotaHook.setLoading,
    quotaHook.setErrors,
  );
  const codexHook = useCodexReset(
    quotaHook.fetchQuota,
    quotaHook.setErrors,
    quotaHook.setLastUpdated,
  );
  const settingsHook = useSettings();

  // Initial data load
  useEffect(() => {
    const initializeData = async () => {
      connectionsHook.setConnectionsLoading(true);
      const visibleConnections = await connectionsHook.fetchConnections(connectionsHook.page);
      connectionsHook.setConnectionsLoading(false);

      // Always fetch fresh quota on mount, no cache display
      quotaHook.setLoading(buildLoadingState(visibleConnections));
      quotaHook.setErrors((prev) =>
        filterQuotaStateByConnections(prev, visibleConnections),
      );
      quotaHook.setQuotaData((prev) =>
        filterQuotaStateByConnections(prev, visibleConnections),
      );

      await Promise.all(
        visibleConnections.map((conn) => quotaHook.fetchQuota(conn.id, conn.provider)),
      );
      quotaHook.setLastUpdated(new Date());
    };

    initializeData();
  }, [connectionsHook.fetchConnections, quotaHook.fetchQuota, connectionsHook.page, connectionsHook, quotaHook]);

  const sortedConnections = useMemo(
    () =>
      sortVisibleConnections(
        connectionsHook.connections,
        quotaHook.quotaData,
        quotaHook.expiringFirst,
        connectionsHook.providerFilter,
        quotaHook.quotaSortMode,
      ),
    [connectionsHook.connections, quotaHook.quotaData, quotaHook.expiringFirst, connectionsHook.providerFilter, quotaHook.quotaSortMode],
  );

  // Connection is depleted when any quota entry hit the threshold
  const isConnectionDepleted = (conn: Connection) => {
    const quotas = quotaHook.quotaData[conn.id]?.quotas;
    if (!quotas?.length) return false;
    return quotas.some((q: QuotaEntry) => {
      if (!q.total || q.total <= 0) return false;
      return calculatePercentage(q.used, q.total) <= DEPLETED_QUOTA_THRESHOLD;
    });
  };

  const handleDisableDepleted = () => {
    const ids = sortedConnections
      .filter((c) => (c.isActive ?? true) && isConnectionDepleted(c))
      .map((c) => c.id);
    actionsHook.bulkSetActive(ids, false);
  };

  const handleEnableAvailable = () => {
    const ids = sortedConnections
      .filter((c) => !(c.isActive ?? true) && !isConnectionDepleted(c))
      .map((c) => c.id);
    actionsHook.bulkSetActive(ids, true);
  };

  const selectedProviderLabel =
    connectionsHook.providerFilter === "all" ? translate("All providers") || "All providers" : connectionsHook.providerFilter;
  const hasEligibleConnections = connectionsHook.totals.eligibleConnections > 0;
  const hasVisibleConnections = sortedConnections.length > 0;
  const emptyState = getConnectionsEmptyMessage(
    connectionsHook.totals,
    connectionsHook.providerFilter,
    connectionsHook.accountFilter,
  );

  if (!connectionsHook.connectionsLoading && !hasEligibleConnections) {
    return (
      <Card padding="lg">
        <div className="text-center py-12">
          <CloudOff className="size-16 text-text-muted opacity-20" />
          <h3 className="mt-4 text-lg font-semibold text-text-primary">
            {translate("No Providers Connected") || "No Providers Connected"}
          </h3>
          <p className="mt-2 text-sm text-text-muted max-w-md mx-auto">
            {translate("Connect to OAuth providers to track their quota limits and API usage.") || "Connect to OAuth providers to track their quota limits and API usage."}
          </p>
        </div>
      </Card>
    );
  }

  if (!connectionsHook.connectionsLoading && !hasVisibleConnections) {
    return (
      <Card padding="lg">
        <div className="text-center py-12">
          {(() => {
            const EmptyIcon = EMPTY_STATE_ICON_MAP[emptyState.icon] || AlertCircle;
            return <EmptyIcon className="size-16 text-text-muted opacity-20" />;
          })()}
          <h3 className="mt-4 text-lg font-semibold text-text-primary">
            {emptyState.title}
          </h3>
          <p className="mt-2 text-sm text-text-muted max-w-md mx-auto">
            {emptyState.description}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header Controls */}
      <ToolbarSection
        providerFilter={connectionsHook.providerFilter}
        setProviderFilter={connectionsHook.setProviderFilter}
        providerMenuOpen={connectionsHook.providerMenuOpen}
        setProviderMenuOpen={connectionsHook.setProviderMenuOpen}
        providerOptions={connectionsHook.providerOptions}
        selectedProviderLabel={selectedProviderLabel}
        accountFilter={connectionsHook.accountFilter}
        setAccountFilter={connectionsHook.setAccountFilter}
        setPage={connectionsHook.setPage}
        quotaSortMode={quotaHook.quotaSortMode}
        setQuotaSortMode={quotaHook.setQuotaSortMode}
        expiringFirst={quotaHook.expiringFirst}
        setExpiringFirst={quotaHook.setExpiringFirst}
        handleDisableDepleted={handleDisableDepleted}
        handleEnableAvailable={handleEnableAvailable}
        bulkToggling={actionsHook.bulkToggling}
        autoRefresh={quotaHook.autoRefresh}
        setAutoRefresh={quotaHook.setAutoRefresh}
        countdown={quotaHook.countdown}
        refreshAll={quotaHook.refreshAll}
        refreshingAll={quotaHook.refreshingAll}
      />

      {/* Provider cards: 2 columns, compact */}
      {quotaHook.expiringFirst && (
        <div className="rounded-xl border border-warning-border bg-warning px-3 py-2 text-xs text-warning-foreground dark:text-warning-foreground">
          {translate("The expiring-first sort reorders accounts within the current page. Sort between pages follows backend pagination.") || "The expiring-first sort reorders accounts within the current page. Sort between pages follows backend pagination."}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sortedConnections.map((conn) => (
          <ConnectionCard
            key={conn.id}
            conn={conn}
            quota={quotaHook.quotaData[conn.id]}
            isLoading={quotaHook.loading[conn.id]}
            error={quotaHook.errors[conn.id]}
            quotaSortMode={quotaHook.quotaSortMode}
            quotaVisibility={settingsHook.quotaVisibility}
            autoPingMaps={settingsHook.autoPingMaps}
            deletingId={actionsHook.deletingId}
            togglingId={actionsHook.togglingId}
            resettingLimitId={codexHook.resettingLimitId}
            refreshProvider={quotaHook.refreshProvider}
            toggleAutoPing={settingsHook.toggleAutoPing}
            handleHideQuota={settingsHook.handleHideQuota}
            handleShowQuota={settingsHook.handleShowQuota}
            handleToggleConnectionActive={actionsHook.handleToggleConnectionActive}
            setSelectedConnection={actionsHook.setSelectedConnection}
            setShowEditModal={actionsHook.setShowEditModal}
            setPendingDeleteId={actionsHook.setPendingDeleteId}
            setShowDeleteConfirm={actionsHook.setShowDeleteConfirm}
            setResetConfirmState={codexHook.setResetConfirmState}
            handleViewCodexResetCredits={codexHook.handleViewCodexResetCredits}
          />
        ))}
      </div>

      <PaginationSection
        pagination={connectionsHook.pagination}
        page={connectionsHook.page}
        setPage={connectionsHook.setPage}
        pageSize={connectionsHook.pageSize}
        setPageSize={connectionsHook.setPageSize}
        customPageSizeInput={connectionsHook.customPageSizeInput}
        setCustomPageSizeInput={connectionsHook.setCustomPageSizeInput}
        connectionsLoading={connectionsHook.connectionsLoading}
        refreshingAll={quotaHook.refreshingAll}
      />

      <ModalsSection
        showDeleteConfirm={actionsHook.showDeleteConfirm}
        setShowDeleteConfirm={actionsHook.setShowDeleteConfirm}
        pendingDeleteId={actionsHook.pendingDeleteId}
        setPendingDeleteId={actionsHook.setPendingDeleteId}
        handleDeleteConnection={actionsHook.handleDeleteConnection}
        resetConfirmState={codexHook.resetConfirmState}
        setResetConfirmState={codexHook.setResetConfirmState}
        resettingLimitId={codexHook.resettingLimitId}
        handleResetCodexLimit={codexHook.handleResetCodexLimit}
        resetCreditsState={codexHook.resetCreditsState}
        setResetCreditsState={codexHook.setResetCreditsState}
        showEditModal={actionsHook.showEditModal}
        setShowEditModal={actionsHook.setShowEditModal}
        selectedConnection={actionsHook.selectedConnection}
        setSelectedConnection={actionsHook.setSelectedConnection}
        proxyPools={actionsHook.proxyPools}
        handleUpdateConnection={actionsHook.handleUpdateConnection}
      />
    </div>
  );
}


