"use client";

import { Card } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { translate } from "@/i18n/runtime";
import { ChevronDown, ChevronUp, Cloud, CloudUpload, FlaskConical, ListChecks, Loader2, Pencil, Plus, Rocket, Terminal, ToggleLeft, ToggleRight, Trash2, Upload } from "lucide-react";
import { useProxyPools } from "./hooks/useProxyPools";
import { useProxyDeploy } from "./hooks/useProxyDeploy";
import { useProxyImport } from "./hooks/useProxyImport";
import ProxyPoolModals from "./sections/ProxyPoolModals";
import { getStatusVariant, getStatusClassName, formatDateTime } from "./types";
export type { ProxyPool } from "./types";
import type { ProxyPool } from "./types";

interface ProxyPoolsClientProps {
  initialProxyPools: ProxyPool[];
}

export default function ProxyPoolsClient({ initialProxyPools }: ProxyPoolsClientProps) {
  const pools = useProxyPools(initialProxyPools);
  const deploy = useProxyDeploy(pools.fetchProxyPools);
  const imp = useProxyImport(pools.proxyPools, pools.fetchProxyPools);

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex justify-end">
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:items-center">
          <div className="relative" ref={deploy.relayMenuRef}>
            <Button
              variant="secondary"
              icon={<Rocket className="size-4" />}
              onClick={() => deploy.setShowRelayMenu(!deploy.showRelayMenu)}
            >
              {translate("Deploy Relay") || "Deploy Relay"}
              {deploy.showRelayMenu ? <ChevronUp className="size-4 ml-1" /> : <ChevronDown className="size-4 ml-1" />}
            </Button>

            {deploy.showRelayMenu && (
              <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-black/10 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-zinc-900 sm:left-auto sm:right-0">
                <Button
                  variant="ghost"
                  onClick={() => {
                    deploy.openCloudflareModal();
                    deploy.setShowRelayMenu(false);
                  }}
                  className="w-full justify-start gap-2 rounded-lg px-3 py-2 text-sm"
                >
                  <Cloud className="size-5" />
                  Cloudflare Relay
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    deploy.openVercelModal();
                    deploy.setShowRelayMenu(false);
                  }}
                  className="w-full justify-start gap-2 rounded-lg px-3 py-2 text-sm"
                >
                  <CloudUpload className="size-5" />
                  Vercel Relay
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    deploy.openDenoModal();
                    deploy.setShowRelayMenu(false);
                  }}
                  className="w-full justify-start gap-2 rounded-lg px-3 py-2 text-sm"
                >
                  <Terminal className="size-5" />
                  Deno Relay
                </Button>
              </div>
            )}
          </div>

          <Button variant="secondary" icon={<Upload className="size-4" />} onClick={imp.openBatchImportModal}>
            {translate("Batch Import") || "Batch Import"}
          </Button>
          <Button icon={<Plus className="size-4" />} onClick={pools.openCreateModal}>{translate("Add Proxy Pool") || "Add Proxy Pool"}</Button>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {pools.proxyPools.length > 0 && (
            <Label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
              <Checkbox
                checked={pools.allSelected}
                onCheckedChange={(checked) => {
                  if (checked === true) {
                    pools.setSelectedIds(pools.proxyPools.map((p) => p.id));
                  } else {
                    pools.setSelectedIds([]);
                  }
                }}
              />
              {pools.allSelected ? (translate("Deselect all") || "Deselect all") : (translate("Select all") || "Select all")}
            </Label>
          )}
          <Badge variant="secondary">{translate("Total:") || "Total:"} {pools.proxyPools.length}</Badge>
          <Badge variant="default" className="bg-success text-success-foreground dark:text-success-foreground">{translate("Active:") || "Active:"} {pools.activeCount}</Badge>
        </div>

        {(pools.selectedIds.length > 0 || pools.healthChecking) && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <ListChecks className="size-5" />
            <span className="text-xs font-medium text-primary">
              {pools.selectedIds.length > 0 ? `${pools.selectedIds.length} ${translate("selected") || "selected"}` : (translate("All pools") || "All pools")}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                icon={pools.healthChecking ? "progress_activity" : "health_and_safety"}
                onClick={pools.handleHealthCheck}
                disabled={pools.healthChecking || pools.bulkBusy || pools.proxyPools.length === 0}
              >
                {pools.healthChecking ? `${translate("Checking") || "Checking"} ${pools.healthProgress.current}/${pools.healthProgress.total}` : (translate("Health Check") || "Health Check")}
              </Button>
              {pools.selectedIds.length > 0 && (
                <>
                  <Button variant="secondary" icon={<ToggleRight className="size-4" />} onClick={() => pools.bulkSetActive(true)} disabled={pools.bulkBusy || pools.healthChecking}>
                    {translate("Activate") || "Activate"}
                  </Button>
                  <Button variant="secondary" icon={<ToggleLeft className="size-4" />} onClick={() => pools.bulkSetActive(false)} disabled={pools.bulkBusy || pools.healthChecking}>
                    {translate("Deactivate") || "Deactivate"}
                  </Button>
                  <Button variant="secondary" icon={<Trash2 className="size-4" />} onClick={pools.bulkDelete} disabled={pools.bulkBusy || pools.healthChecking}>
                    {translate("Delete") || "Delete"}
                  </Button>
                  <Button variant="ghost" onClick={pools.clearSelection} disabled={pools.bulkBusy || pools.healthChecking}>
                    {translate("Clear") || "Clear"}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {pools.proxyPools.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-text-main font-medium mb-1">{translate("No proxy pool entries yet") || "No proxy pool entries yet"}</p>
            <p className="text-sm text-text-muted mb-4">
              {translate("Create a proxy pool entry, then assign it to connections.") || "Create a proxy pool entry, then assign it to connections."}
            </p>
            <Button icon={<Plus className="size-4" />} onClick={pools.openCreateModal}>{translate("Add Proxy Pool") || "Add Proxy Pool"}</Button>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {pools.proxyPools.map((pool) => (
              <div key={pool.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <Checkbox
                    checked={pools.selectedIds.includes(pool.id)}
                    onCheckedChange={(checked) => {
                      if (checked === true) {
                        pools.setSelectedIds((prev) => [...prev, pool.id]);
                      } else {
                        pools.setSelectedIds((prev) => prev.filter((x) => x !== pool.id));
                      }
                    }}
                    className="mt-1 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="min-w-0 max-w-full truncate text-sm font-medium sm:max-w-[18rem]">{pool.name}</p>
                    <Badge variant={getStatusVariant(pool.testStatus)} className={getStatusClassName(pool.testStatus)}>
                      {pool.testStatus || "unknown"}
                    </Badge>
                    <Badge variant={pool.isActive ? "default" : "secondary"} className={pool.isActive ? "bg-success text-success-foreground dark:text-success-foreground" : undefined}>
                      {pool.isActive ? (translate("Active") || "active") : (translate("Inactive") || "inactive")}
                    </Badge>
                    {pool.type === "vercel" && (
                      <Badge variant="secondary" >vercel relay</Badge>
                    )}
                    {pool.type === "cloudflare" && (
                      <Badge variant="secondary" >cloudflare relay</Badge>
                    )}
                    <Badge variant="secondary" >
                      {pool.boundConnectionCount || 0} {translate("bound") || "bound"}
                    </Badge>
                  </div>
                  <p className="text-xs text-text-muted truncate mt-1">{pool.proxyUrl}</p>
                  {pool.noProxy ? (
                    <p className="text-xs text-text-muted truncate">No proxy: {pool.noProxy}</p>
                  ) : null}
                  <p className="text-[11px] text-text-muted mt-1">
                    {translate("Last tested:") || "Last tested:"} {formatDateTime(pool.lastTestedAt)}
                    {pool.lastError ? ` · ${pool.lastError}` : ""}
                  </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1">
                  <Switch
                    checked={pool.isActive === true}
                    onCheckedChange={() => pools.handleToggleActive(pool)}
                    title={pool.isActive ? (translate("Disable") || "Disable") : (translate("Enable") || "Enable")}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => pools.handleTest(pool.id)}
                    title="Test proxy"
                    disabled={pools.testingId === pool.id}
                  >
                    {pools.testingId === pool.id ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => pools.openEditModal(pool)}
                    title="Edit"
                  >
                    <Pencil className="size-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => pools.handleDelete(pool)}
                    className="text-destructive-foreground hover:bg-destructive hover:text-destructive-foreground"
                    title={translate("Delete") ?? undefined}
                  >
                    <Trash2 className="size-5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ProxyPoolModals
        showFormModal={pools.showFormModal}
        editingProxyPool={pools.editingProxyPool}
        formData={pools.formData}
        setFormData={pools.setFormData}
        saving={pools.saving}
        closeFormModal={pools.closeFormModal}
        handleSave={pools.handleSave}
        showBatchImportModal={imp.showBatchImportModal}
        batchImportText={imp.batchImportText}
        setBatchImportText={imp.setBatchImportText}
        importing={imp.importing}
        closeBatchImportModal={imp.closeBatchImportModal}
        handleBatchImport={imp.handleBatchImport}
        showVercelModal={deploy.showVercelModal}
        vercelForm={deploy.vercelForm}
        setVercelForm={deploy.setVercelForm}
        deploying={deploy.deploying}
        closeVercelModal={deploy.closeVercelModal}
        handleVercelDeploy={deploy.handleVercelDeploy}
        showCloudflareModal={deploy.showCloudflareModal}
        cloudflareForm={deploy.cloudflareForm}
        setCloudflareForm={deploy.setCloudflareForm}
        closeCloudflareModal={deploy.closeCloudflareModal}
        handleCloudflareDeploy={deploy.handleCloudflareDeploy}
        showDenoModal={deploy.showDenoModal}
        denoForm={deploy.denoForm}
        setDenoForm={deploy.setDenoForm}
        closeDenoModal={deploy.closeDenoModal}
        handleDenoDeploy={deploy.handleDenoDeploy}
        confirmState={pools.confirmState}
        setConfirmState={pools.setConfirmState}
      />
    </div>
  );
}
