"use client";

import { Button, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { ArrowLeftRight, Network, Unlink } from "lucide-react";
import type { ProxyPool } from "../../types";

interface BulkProxyModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionCount: number;
  onApplyOneToOne: () => void;
  onApplySinglePool: (poolId: string | null) => void;
  bulkUpdatingProxy: boolean;
  activePools: ProxyPool[];
  proxyPools: ProxyPool[];
}

export default function BulkProxyModal({
  isOpen,
  onClose,
  connectionCount,
  onApplyOneToOne,
  onApplySinglePool,
  bulkUpdatingProxy,
  activePools,
  proxyPools,
}: BulkProxyModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${translate("Apply Proxy")} (${connectionCount} ${translate("connections")})`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <Button
            variant="ghost"
            onClick={onApplyOneToOne}
            disabled={bulkUpdatingProxy || activePools.length === 0}
            className="justify-start gap-2"
          >
            <ArrowLeftRight className="size-5" />
            <span className="text-sm text-text-main">{translate("One-to-one (rotate)")}</span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => onApplySinglePool(null)}
            disabled={bulkUpdatingProxy}
            className="justify-start gap-2"
          >
            <Unlink className="size-5" />
            <span className="text-sm text-text-main">{translate("None (unbind all)")}</span>
          </Button>
          {proxyPools.map((pool) => (
            <Button
              key={pool.id}
              variant="ghost"
              onClick={() => onApplySinglePool(pool.id)}
              disabled={bulkUpdatingProxy || pool.isActive !== true}
              className="justify-start gap-2"
            >
              <Network className="size-5" />
              <span className="truncate text-sm text-text-main">{pool.name}</span>
              {pool.isActive !== true && (
                <span className="text-[10px] text-text-muted">({translate("Inactive")})</span>
              )}
            </Button>
          ))}
        </div>

        {bulkUpdatingProxy && <p className="text-xs text-text-muted">{translate("Applying...")}</p>}

        <Button onClick={onClose} variant="ghost" fullWidth disabled={bulkUpdatingProxy}>
          {translate("Cancel")}
        </Button>
      </div>
    </Modal>
  );
}
