"use client";

import { Button } from "@/shared/components";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { translate } from "@/i18n/runtime";
import { Network, Plus, RefreshCw, Square, Trash2 } from "lucide-react";
import RoundRobinToggle from "./RoundRobinToggle";
import type { Connection, ProxyPool } from "../../types";

interface ConnectionsToolbarProps {
  isFreeNoAuth: boolean;
  showOptionalKeySection: boolean;
  onHideOptionalKey: () => void;
  connections: Connection[];
  allSelected: boolean;
  onSelectAll: (ids: string[]) => void;
  isCompatible: boolean;
  providerId: string;
  hasDualAuthModes: boolean;
  onAdd: () => void;
  proxyPools: ProxyPool[];
  onShowBulkProxy: () => void;
  selectedCount: number;
  onBulkDelete: () => void;
  oneByOneRunning: boolean;
  onRunOneByOne: () => void;
  oneByOneStopping: boolean;
  onStopOneByOne: () => void;
  providerStrategy: string | null;
  onRoundRobinToggle: (enabled: boolean) => void;
  providerStickyLimit: string;
  onStickyLimitChange: (value: string) => void;
}

export default function ConnectionsToolbar({
  isFreeNoAuth,
  showOptionalKeySection,
  onHideOptionalKey,
  connections,
  allSelected,
  onSelectAll,
  isCompatible,
  providerId,
  hasDualAuthModes,
  onAdd,
  proxyPools,
  onShowBulkProxy,
  selectedCount,
  onBulkDelete,
  oneByOneRunning,
  onRunOneByOne,
  oneByOneStopping,
  onStopOneByOne,
  providerStrategy,
  onRoundRobinToggle,
  providerStickyLimit,
  onStickyLimitChange,
}: ConnectionsToolbarProps) {
  return (
    <div className="mb-3 flex flex-col gap-2 border-b border-border-subtle pb-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 id="connections-heading" className="text-lg font-semibold">{isFreeNoAuth ? translate("Your API Key (optional)") : "Connections"}</h2>
        {isFreeNoAuth && showOptionalKeySection && (
          <button type="button" onClick={onHideOptionalKey} className="text-xs text-text-muted hover:text-primary">
            {translate("Hide")}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {connections.length > 0 && (
          <Label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted hover:text-primary">
            <Checkbox checked={allSelected} onCheckedChange={(checked) => onSelectAll(checked === true ? connections.map((conn) => conn.id) : [])} />
            {translate("Select All")}
          </Label>
        )}
        {connections.length > 0 && !isCompatible && providerId !== "iflow" && providerId !== "codex" && !hasDualAuthModes && (
          <Button icon={<Plus className="size-4" />} onClick={onAdd}>Add</Button>
        )}
        {connections.length > 0 && proxyPools.length > 0 && (
          <Button variant="secondary" icon={<Network className="size-4" />} onClick={onShowBulkProxy}>
            {translate("Apply Proxy")}
          </Button>
        )}
        {connections.length > 0 && (
          <>
            {selectedCount > 0 && (
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={onBulkDelete}>
                Delete Selected ({selectedCount})
              </Button>
            )}
            <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={onRunOneByOne} disabled={oneByOneRunning}>
              {oneByOneRunning ? "Testing Connection One-by-One..." : "Test Connection One-by-One"}
            </Button>
            {oneByOneRunning && (
              <Button variant="ghost" icon={<Square className="size-4" />} onClick={onStopOneByOne} disabled={oneByOneStopping}>
                {oneByOneStopping ? "Stopping..." : "Stop"}
              </Button>
            )}
          </>
        )}
        <RoundRobinToggle
          providerStrategy={providerStrategy}
          onRoundRobinToggle={onRoundRobinToggle}
          providerStickyLimit={providerStickyLimit}
          onStickyLimitChange={onStickyLimitChange}
        />
      </div>
    </div>
  );
}
