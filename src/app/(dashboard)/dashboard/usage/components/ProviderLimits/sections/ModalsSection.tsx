"use client";

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ConfirmModal, EditConnectionModal } from "@/shared/components";
import { getConnectionLabel } from "../utils";
import { translate } from "@/i18n/runtime";
import { Loader2, X } from "lucide-react";
import type { Connection } from "../utils";
import type { ResetConfirmState, ResetCreditsState } from "../types";

function formatCreditDate(value: string | Date | null | undefined) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "N/A";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeRemaining(value: string | Date | null | undefined) {
  if (!value) return "N/A";
  const diffMs = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return "N/A";
  if (diffMs <= 0) return "Expired";
  const totalHours = Math.ceil(diffMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

interface ModalsSectionProps {
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  pendingDeleteId: string | null;
  setPendingDeleteId: React.Dispatch<React.SetStateAction<string | null>>;
  handleDeleteConnection: (id: string) => Promise<void>;
  resetConfirmState: ResetConfirmState | null;
  setResetConfirmState: React.Dispatch<React.SetStateAction<ResetConfirmState | null>>;
  resettingLimitId: string | null;
  handleResetCodexLimit: (connectionId: string, provider: string) => Promise<void>;
  resetCreditsState: ResetCreditsState | null;
  setResetCreditsState: React.Dispatch<React.SetStateAction<ResetCreditsState | null>>;
  showEditModal: boolean;
  setShowEditModal: React.Dispatch<React.SetStateAction<boolean>>;
  selectedConnection: Connection | null;
  setSelectedConnection: React.Dispatch<React.SetStateAction<Connection | null>>;
  proxyPools: Array<{ id: string; name: string }>;
  handleUpdateConnection: (formData: Record<string, unknown>) => Promise<void>;
}

export default function ModalsSection({
  showDeleteConfirm,
  setShowDeleteConfirm,
  pendingDeleteId,
  setPendingDeleteId,
  handleDeleteConnection,
  resetConfirmState,
  setResetConfirmState,
  resettingLimitId,
  handleResetCodexLimit,
  resetCreditsState,
  setResetCreditsState,
  showEditModal,
  setShowEditModal,
  selectedConnection,
  setSelectedConnection,
  proxyPools: _proxyPools,
  handleUpdateConnection,
}: ModalsSectionProps) {
  return (
    <>
      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setPendingDeleteId(null);
        }}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          if (pendingDeleteId) {
            handleDeleteConnection(pendingDeleteId);
            setPendingDeleteId(null);
          }
        }}
        title={translate("Delete") || "Delete"}
        message={translate("Delete this connection?") || "Delete this connection?"}
        confirmText={translate("Delete") || "Delete"}
        cancelText={translate("Cancel") || "Cancel"}
        variant="danger"
      />

      <ConfirmModal
        isOpen={Boolean(resetConfirmState)}
        onClose={() => {
          if (!resettingLimitId) setResetConfirmState(null);
        }}
        onConfirm={async () => {
          const connection = resetConfirmState?.connection;
          if (!connection) return;
          await handleResetCodexLimit(connection.id, connection.provider);
          setResetConfirmState(null);
        }}
        title={translate("Reset Codex limit?") || "Reset Codex limit?"}
        message={`Use 1 Codex reset credit for ${(resetConfirmState?.connection ? getConnectionLabel(resetConfirmState.connection) : null) || "this account"}. This cannot be undone. Remaining credits: ${resetConfirmState?.resetCreditCount ?? 0}.`}
        confirmText={translate("Reset limit") || "Reset limit"}
        cancelText={translate("Cancel") || "Cancel"}
        variant="danger"
        loading={Boolean(resettingLimitId)}
      />

      {resetCreditsState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-black/15 bg-white shadow-2xl ring-1 ring-black/10 dark:border-white/15 dark:bg-neutral-950 dark:ring-white/10">
            <div className="flex items-start justify-between gap-3 border-b border-black/10 bg-black/[0.03] px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-text-primary">Codex Reset Credit Expiry</h3>
                <p className="mt-0.5 truncate text-xs text-text-muted">
                  {getConnectionLabel(resetCreditsState.connection) || "Codex account"}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setResetCreditsState(null)}
                className="text-text-muted hover:text-text-primary"
                aria-label="Close reset credit expiry modal"
              >
                <X className="size-5" />
              </Button>
            </div>

            <div className="max-h-[70vh] overflow-auto bg-white p-4 dark:bg-neutral-950">
              {resetCreditsState.loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
                  <Loader2 className="size-5" />
                  {translate("Loading reset credits...") || "Loading reset credits..."}
                </div>
              ) : resetCreditsState.error ? (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                  {resetCreditsState.error}
                </div>
              ) : resetCreditsState.data?.credits?.length ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
                    <span>{resetCreditsState.data.credits.length} reset credit{resetCreditsState.data.credits.length === 1 ? "" : "s"}</span>
                    <span>{resetCreditsState.data.availableCount ?? 0} available</span>
                  </div>
                  <div className="rounded-xl border border-black/10 dark:border-white/10">
                    <Table className="min-w-[560px] text-left">
                      <TableHeader className="bg-black/[0.03] text-xs uppercase tracking-wide text-text-muted dark:bg-white/[0.04]">
                        <TableRow>
                          <TableHead className="px-3 py-2 font-medium">Status</TableHead>
                          <TableHead className="px-3 py-2 font-medium">Granted At</TableHead>
                          <TableHead className="px-3 py-2 font-medium">Expires At</TableHead>
                          <TableHead className="px-3 py-2 font-medium">Remaining</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {resetCreditsState.data.credits.map((credit, index) => (
                          <TableRow key={`${credit.status}-${credit.expiresAt || index}`}>
                            <TableCell className="px-3 py-2">
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                {credit.status || "unknown"}
                              </span>
                            </TableCell>
                            <TableCell className="px-3 py-2 text-text-muted">{formatCreditDate(credit.grantedAt)}</TableCell>
                            <TableCell className="px-3 py-2 text-text-primary">{formatCreditDate(credit.expiresAt)}</TableCell>
                            <TableCell className="px-3 py-2 font-medium text-text-primary">{formatTimeRemaining(credit.expiresAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-8 text-center text-sm text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
                  {translate("No reset credit details returned for this account.") || "No reset credit details returned for this account."}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        onSave={handleUpdateConnection}
        onClose={() => {
          setShowEditModal(false);
          setSelectedConnection(null);
        }}
      />
    </>
  );
}


