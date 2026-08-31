"use client";

import type { useRouter } from "next/navigation";
import {
  Card,
  Button,
  Modal,
  OAuthModal,
  KiroOAuthWrapper,
  CursorAuthModal,
  IFlowCookieModal,
  GitLabAuthModal,
  EditConnectionModal,
  NoAuthProxyCard,
  ConfirmModal,
} from "@/shared/components";
import { Switch } from "@/components/ui/switch";
import { Input as RawInput } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { translate } from "@/i18n/runtime";
import ConnectionRow from "../ConnectionRow";
import AddApiKeyModal from "../AddApiKeyModal";
import EditCompatibleNodeModal from "../EditCompatibleNodeModal";
import BulkImportCodexModal from "../BulkImportCodexModal";
import {
  ArrowLeftRight,
  ChevronDown,
  Cookie,
  Key,
  ListPlus,
  Lock,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  Unlink,
} from "lucide-react";
import type { UseProviderConnectionsReturn } from "../hooks/useProviderConnections";
import { AUTO_PING_SETTINGS_KEYS } from "../hooks/useProviderConnections";
import type { ProviderInfo } from "../types";

interface ConnectionsSectionProps {
  providerId: string;
  providerInfo: ProviderInfo;
  connectionsHook: UseProviderConnectionsReturn;
  isCompatible: boolean;
  isAnthropicCompatible: boolean;
  isFreeNoAuth: boolean;
  isOAuth: boolean;
  hasDualAuthModes: boolean;
  oauthConnectionLabel: string;
  apiKeyConnectionLabel: string;
  router: ReturnType<typeof useRouter>;
}

export default function ConnectionsSection({
  providerId,
  providerInfo,
  connectionsHook: c,
  isCompatible,
  isAnthropicCompatible,
  isFreeNoAuth,
  isOAuth,
  hasDualAuthModes,
  oauthConnectionLabel,
  apiKeyConnectionLabel,
  router,
}: ConnectionsSectionProps) {
  const activePools = c.proxyPools.filter((p) => p.isActive === true);

  const handleDeleteProviderNode = () => {
    c.setConfirmState({
      title: "Delete Compatible Node",
      message: `Delete this ${isAnthropicCompatible ? "Anthropic" : "OpenAI"} Compatible node?`,
      onConfirm: async () => {
        c.setConfirmState(null);
        try {
          const res = await fetch(`/api/provider-nodes/${providerId}`, { method: "DELETE" });
          if (res.ok) {
            router.push("/dashboard/providers");
          }
        } catch (error) {
          console.error("Error deleting provider node:", error);
        }
      },
    });
  };

  const connectionsList = (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface divide-y divide-black/[0.03] dark:divide-white/[0.03]">
      {c.connections.map((conn, index) => (
        <div key={conn.id} className="flex min-w-0 items-stretch">
          <div className="flex shrink-0 items-center pl-1 sm:pl-2">
            <Checkbox
              checked={c.isSelected(conn.id)}
              onCheckedChange={(checked) => {
                if (checked === true) {
                  c.setSelectedConnectionIds((prev) => [...prev, conn.id]);
                } else {
                  c.setSelectedConnectionIds((prev) => prev.filter((id) => id !== conn.id));
                }
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <ConnectionRow
              connection={conn}
              proxyPools={c.proxyPools}
              isOAuth={isOAuth}
              isFirst={index === 0}
              isLast={index === c.connections.length - 1}
              onMoveUp={() => c.handleSwapPriority(index, index - 1)}
              onMoveDown={() => c.handleSwapPriority(index, index + 1)}
              onToggleActive={(isActive) => c.handleUpdateConnectionStatus(conn.id, isActive)}
              autoPing={AUTO_PING_SETTINGS_KEYS[providerId] && conn.authType === "oauth" ? {
                on: c.autoPing.connections[conn.id] === true,
                onToggle: (on) => c.handleAutoPingConnection(conn.id, on),
                provider: providerId,
              } : null}
              onUpdateProxy={async (proxyPoolId) => {
                try {
                  const res = await fetch(`/api/providers/${conn.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ proxyPoolId: proxyPoolId || null }),
                  });
                  if (res.ok) {
                    c.setConnections(prev => prev.map(item =>
                      item.id === conn.id
                        ? { ...item, providerSpecificData: { ...item.providerSpecificData, proxyPoolId: proxyPoolId ?? undefined } }
                        : item
                    ));
                  }
                } catch (error) {
                  console.error("Error updating proxy:", error);
                }
              }}
              onEdit={() => {
                c.setSelectedConnection(conn);
                c.setShowEditModal(true);
              }}
              onDelete={() => c.handleDelete(conn.id)}
              oneByOneStatus={c.oneByOneResults[conn.id] || null}
            />
          </div>
        </div>
      ))}
    </div>
  );

  const bulkActionModal = (
    <Modal
      isOpen={c.showBulkProxyModal}
      onClose={c.closeBulkProxyModal}
      title={`${translate("Apply Proxy")} (${c.connections.length} ${translate("connections")})`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <Button
            variant="ghost"
            onClick={c.handleApplyOneToOne}
            disabled={c.bulkUpdatingProxy || activePools.length === 0}
            className="justify-start gap-2"
          >
            <ArrowLeftRight className="size-5" />
            <span className="text-sm text-text-main">{translate("One-to-one (rotate)")}</span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => c.handleApplySinglePool(null)}
            disabled={c.bulkUpdatingProxy}
            className="justify-start gap-2"
          >
            <Unlink className="size-5" />
            <span className="text-sm text-text-main">{translate("None (unbind all)")}</span>
          </Button>
          {c.proxyPools.map((pool) => (
            <Button
              key={pool.id}
              variant="ghost"
              onClick={() => c.handleApplySinglePool(pool.id)}
              disabled={c.bulkUpdatingProxy || pool.isActive !== true}
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

        {c.bulkUpdatingProxy && <p className="text-xs text-text-muted">{translate("Applying...")}</p>}

        <Button onClick={c.closeBulkProxyModal} variant="ghost" fullWidth disabled={c.bulkUpdatingProxy}>
          {translate("Cancel")}
        </Button>
      </div>
    </Modal>
  );

  return (
    <>
      {isCompatible && c.providerNode && (
        <Card padding="sm" className="overflow-visible">
          <div className="mb-5 flex flex-col gap-4 border-b border-border-subtle pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{isAnthropicCompatible ? "Anthropic Compatible Details" : "OpenAI Compatible Details"}</h2>
              <p className="break-all text-sm text-text-muted">
                {isAnthropicCompatible ? "Messages API" : (c.providerNode.apiType === "responses" ? "Responses API" : "Chat Completions")} · {(c.providerNode.baseUrl || "").replace(/\/$/, "")}/
                {isAnthropicCompatible ? "messages" : (c.providerNode.apiType === "responses" ? "responses" : "chat/completions")}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
              <Button
                icon={<Plus className="size-4" />}
                onClick={() => {
                  c.setAddConnectionError("");
                  c.setShowAddApiKeyModal(true);
                }}
                className="w-full sm:w-auto"
              >
                {translate("Add API Key")}
              </Button>
              <Button
                variant="secondary"
                icon={<Pencil className="size-4" />}
                onClick={() => c.setShowEditNodeModal(true)}
                className="w-full sm:w-auto"
              >
                {translate("Edit")}
              </Button>
              <Button
                variant="secondary"
                icon={<Trash2 className="size-4" />}
                onClick={handleDeleteProviderNode}
                className="w-full sm:w-auto"
              >
                {translate("Delete")}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {isFreeNoAuth && <NoAuthProxyCard providerId={providerId} />}
      {isFreeNoAuth && !c.showOptionalKeySection && providerInfo?.authType === "apikey" && (
        <button
          type="button"
          onClick={() => c.setShowOptionalKeySection(true)}
          className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-border-subtle bg-surface px-4 py-3 text-left text-sm text-text-muted transition-colors hover:border-primary/40 hover:text-primary"
        >
          <span className="flex items-center gap-2">
            <Key className="size-4" />
            {translate("Add your own API key")}
            <span className="text-xs font-normal opacity-70">({translate("optional — for priority queue access")})</span>
          </span>
          <ChevronDown className="size-4 -rotate-90" />
        </button>
      )}
      {(!isFreeNoAuth || (providerInfo?.authType === "apikey" && c.showOptionalKeySection)) && (
        <section className="flex min-w-0 flex-col gap-2" aria-labelledby="connections-heading">
          <div className="mb-3 flex flex-col gap-2 border-b border-border-subtle pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="connections-heading" className="text-lg font-semibold">{isFreeNoAuth ? translate("Your API Key (optional)") : "Connections"}</h2>
              {isFreeNoAuth && (
                <button
                  type="button"
                  onClick={() => c.setShowOptionalKeySection(false)}
                  className="text-xs text-text-muted hover:text-primary"
                >
                  {translate("Hide")}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {c.connections.length > 0 && (
                <Label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted hover:text-primary">
                  <Checkbox
                    checked={c.allSelected}
                    onCheckedChange={(checked) => c.setSelectedConnectionIds(checked === true ? c.connections.map((conn) => conn.id) : [])}
                  />
                  {translate("Select All")}
                </Label>
              )}
              {c.connections.length > 0 && !isCompatible && providerId !== "iflow" && providerId !== "codex" && !hasDualAuthModes && (
                <Button icon={<Plus className="size-4" />} onClick={() => c.triggerAddConnection(isOAuth)}>Add</Button>
              )}
              {c.connections.length > 0 && c.proxyPools.length > 0 && (
                <Button
                  variant="secondary"
                  icon={<Network className="size-4" />}
                  onClick={() => c.setShowBulkProxyModal(true)}
                >
                  {translate("Apply Proxy")}
                </Button>
              )}
              {c.connections.length > 0 && (
                <>
                  {c.selectedConnectionIds.length > 0 && (
                    <Button
                      variant="danger"
                      icon={<Trash2 className="size-4" />}
                      onClick={c.handleBulkDelete}
                    >
                      Delete Selected ({c.selectedConnectionIds.length})
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    icon={<RefreshCw className="size-4" />}
                    onClick={c.handleRunOneByOneTest}
                    disabled={c.oneByOneRunning}
                  >
                    {c.oneByOneRunning ? "Testing Connection One-by-One..." : "Test Connection One-by-One"}
                  </Button>
                  {c.oneByOneRunning && (
                    <Button
                      variant="ghost"
                      icon={<Square className="size-4" />}
                      onClick={c.handleStopOneByOneTest}
                      disabled={c.oneByOneStopping}
                    >
                      {c.oneByOneStopping ? "Stopping..." : "Stop"}
                    </Button>
                  )}
                </>
              )}
              {/* Round Robin toggle */}
              <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg px-2.5 py-1.5">
                <span className="text-xs text-text-muted font-medium">Round Robin</span>
                <Switch
                  checked={c.providerStrategy === "round-robin"}
                  onCheckedChange={c.handleRoundRobinToggle}
                />
                {c.providerStrategy === "round-robin" && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-text-muted">Sticky:</span>
                    <RawInput
                      type="number"
                      min={1}
                      value={c.providerStickyLimit}
                      onChange={(e) => c.handleStickyLimitChange(e.target.value)}
                      placeholder="1"
                      className="w-14 px-2 py-1 text-xs"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {c.connections.length === 0 ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary shrink-0">
                  <span className="text-[18px]">{isOAuth ? <Lock className="size-[18px]" /> : <Key className="size-[18px]" />}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-text-muted">No connections yet</p>
                  {hasDualAuthModes && (
                    <p className="text-xs text-text-muted">
                      Choose {oauthConnectionLabel} or {apiKeyConnectionLabel}.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {hasDualAuthModes ? (
                  <>
                    <Button icon={<Lock className="size-4" />} variant="secondary" onClick={() => c.triggerOAuthConnection(isOAuth)}>
                      {oauthConnectionLabel}
                    </Button>
                    <Button icon={<Key className="size-4" />} onClick={c.triggerApiKeyConnection}>
                      {apiKeyConnectionLabel}
                    </Button>
                  </>
                ) : (
                  <>
                    {!isCompatible && providerId === "iflow" && (
                      <Button icon={<Cookie className="size-4" />} variant="secondary" onClick={() => c.setShowIFlowCookieModal(true)}>
                        Cookie
                      </Button>
                    )}
                    {providerId === "codex" && (
                      <Button icon={<ListPlus className="size-4" />} variant="secondary" onClick={() => c.setShowBulkImportCodex(true)}>
                        {translate("Bulk Add")}
                      </Button>
                    )}
                    <Button
                      icon={<Plus className="size-4" />}
                      onClick={() => c.triggerAddConnection(isOAuth)}
                    >
                      {isCompatible ? translate("Add API Key") : (providerId === "iflow" ? "OAuth" : translate("Add Connection"))}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {c.oneByOneSummary && (
                <div className="mb-4 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
                  {c.oneByOneSummary.total > 0 && (
                    <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${(c.oneByOneSummary.completed / c.oneByOneSummary.total) * 100}%` }}
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <span>Total: {c.oneByOneSummary.total}</span>
                    <span>Completed: {c.oneByOneSummary.completed}</span>
                    <span>Passed: {c.oneByOneSummary.passed}</span>
                    <span>Failed: {c.oneByOneSummary.failed}</span>
                    {c.oneByOneSummary.stopped && (
                      <span className="text-amber-600 dark:text-amber-400">Stopped</span>
                    )}
                    {c.oneByOneRunning && c.oneByOneCurrentConnectionId && (
                      <span>Running: {c.connections.find((conn) => conn.id === c.oneByOneCurrentConnectionId)?.name || c.oneByOneCurrentConnectionId}</span>
                    )}
                  </div>
                </div>
              )}
              {c.connections.length > 0 && (
                <div className="hidden mb-2 flex items-center justify-between gap-2 border-b border-black/[0.03] pb-2 dark:border-white/[0.03]">
                  <Label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted hover:text-primary">
                    <Checkbox
                      checked={c.allSelected}
                      onCheckedChange={(checked) => {
                        if (checked === true) {
                          c.setSelectedConnectionIds(c.connections.map((conn) => conn.id));
                        } else {
                          c.setSelectedConnectionIds([]);
                        }
                      }}
                    />
                    {translate("Select All")}
                  </Label>
                </div>
              )}
              {connectionsList}
              {!isCompatible && (providerId === "iflow" || providerId === "codex" || hasDualAuthModes) && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:flex">
                  {providerId === "iflow" && (
                    <Button
                      icon={<Cookie className="size-4" />}
                      variant="secondary"
                      onClick={() => c.setShowIFlowCookieModal(true)}
                      title="Add connection using browser cookie"
                      className="w-full sm:w-auto"
                    >
                      Cookie
                    </Button>
                  )}
                  {providerId === "codex" && (
                    <Button
                      icon={<ListPlus className="size-4" />}
                      variant="secondary"
                      onClick={() => c.setShowBulkImportCodex(true)}
                      title={translate("Bulk import codex accounts from JSON") ?? undefined}
                      className="w-full sm:w-auto"
                    >
                      {translate("Bulk Add")}
                    </Button>
                  )}
                  {hasDualAuthModes ? (
                    <>
                      <Button
                        icon={<Lock className="size-4" />}
                        variant="secondary"
                        onClick={() => c.triggerOAuthConnection(isOAuth)}
                        className="w-full sm:w-auto"
                      >
                        {oauthConnectionLabel}
                      </Button>
                      <Button
                        icon={<Key className="size-4" />}
                        onClick={c.triggerApiKeyConnection}
                        className="w-full sm:w-auto"
                      >
                        {apiKeyConnectionLabel}
                      </Button>
                    </>
                  ) : (
                    <Button
                      icon={<Plus className="size-4" />}
                      onClick={() => c.triggerAddConnection(isOAuth)}
                      className="w-full sm:w-auto"
                    >
                      Add
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {bulkActionModal}

      {providerId === "kiro" ? (
        <KiroOAuthWrapper
          isOpen={c.showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={c.handleOAuthSuccess}
          onClose={() => c.setShowOAuthModal(false)}
        />
      ) : providerId === "cursor" ? (
        <CursorAuthModal
          isOpen={c.showOAuthModal}
          onSuccess={c.handleOAuthSuccess}
          onClose={() => c.setShowOAuthModal(false)}
        />
      ) : providerId === "gitlab" ? (
        <GitLabAuthModal
          isOpen={c.showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={c.handleOAuthSuccess}
          onClose={() => c.setShowOAuthModal(false)}
        />
      ) : (
        <OAuthModal
          isOpen={c.showOAuthModal}
          provider={providerId}
          providerInfo={providerInfo}
          onSuccess={c.handleOAuthSuccess}
          onClose={() => c.setShowOAuthModal(false)}
        />
      )}
      {providerId === "iflow" && (
        <IFlowCookieModal
          isOpen={c.showIFlowCookieModal}
          onSuccess={c.handleIFlowCookieSuccess}
          onClose={() => c.setShowIFlowCookieModal(false)}
        />
      )}
      <AddApiKeyModal
        isOpen={c.showAddApiKeyModal}
        provider={providerId}
        providerName={providerInfo.name}
        isCompatible={isCompatible}
        isAnthropic={isAnthropicCompatible}
        authType={providerInfo?.authType}
        authHint={providerInfo?.authHint}
        website={providerInfo?.website}
        proxyPools={c.proxyPools}
        error={c.addConnectionError}
        existingNames={c.connections.map((conn) => conn.name).filter(Boolean) as string[]}
        onSave={c.handleSaveApiKey}
        onBulkDone={c.fetchConnections}
        onClose={() => {
          c.setAddConnectionError("");
          c.setShowAddApiKeyModal(false);
        }}
      />
      <EditConnectionModal
        isOpen={c.showEditModal}
        connection={c.selectedConnection}
        proxyPools={c.proxyPools}
        onSave={c.handleUpdateConnection}
        onClose={() => c.setShowEditModal(false)}
      />
      {isCompatible && (
        <EditCompatibleNodeModal
          isOpen={c.showEditNodeModal}
          node={c.providerNode}
          onSave={c.handleUpdateNode}
          onClose={() => c.setShowEditNodeModal(false)}
          isAnthropic={isAnthropicCompatible}
        />
      )}
      {providerId === "codex" && (
        <BulkImportCodexModal
          isOpen={c.showBulkImportCodex}
          onClose={() => c.setShowBulkImportCodex(false)}
          onSuccess={c.fetchConnections}
        />
      )}

      {/* AG Risk Confirmation Modal */}
      <ConfirmModal
        isOpen={c.showAgRiskModal}
        onClose={() => c.setShowAgRiskModal(false)}
        onConfirm={() => c.handleAgRiskConfirm(isOAuth)}
        title="Risk Notice"
        message={providerInfo?.deprecationNotice}
        confirmText="I Understand, Continue"
        cancelText={translate("Cancel") || "Cancel"}
        variant="danger"
      />

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!c.confirmState}
        onClose={() => c.setConfirmState(null)}
        onConfirm={c.confirmState?.onConfirm ?? (() => {})}
        title={c.confirmState?.title || "Confirm"}
        message={c.confirmState?.message}
        variant="danger"
      />
    </>
  );
}
