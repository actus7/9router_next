"use client";

import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import { Cookie, Key, ListPlus, Lock, Plus } from "lucide-react";

interface EmptyConnectionsStateProps {
  isOAuth: boolean;
  hasDualAuthModes: boolean;
  oauthConnectionLabel: string;
  apiKeyConnectionLabel: string;
  onTriggerOAuth: () => void;
  onTriggerApiKey: () => void;
  providerId: string;
  onAddConnection: () => void;
  onShowIFlowCookie: () => void;
  onShowBulkImportCodex: () => void;
}

export default function EmptyConnectionsState({
  isOAuth,
  hasDualAuthModes,
  oauthConnectionLabel,
  apiKeyConnectionLabel,
  onTriggerOAuth,
  onTriggerApiKey,
  providerId,
  onAddConnection,
  onShowIFlowCookie,
  onShowBulkImportCodex,
}: EmptyConnectionsStateProps) {
  return (
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
            <Button icon={<Lock className="size-4" />} variant="secondary" onClick={onTriggerOAuth}>
              {oauthConnectionLabel}
            </Button>
            <Button icon={<Key className="size-4" />} onClick={onTriggerApiKey}>
              {apiKeyConnectionLabel}
            </Button>
          </>
        ) : (
          <>
            {providerId === "iflow" && (
              <Button icon={<Cookie className="size-4" />} variant="secondary" onClick={onShowIFlowCookie}>
                Cookie
              </Button>
            )}
            {providerId === "codex" && (
              <Button icon={<ListPlus className="size-4" />} variant="secondary" onClick={onShowBulkImportCodex}>
                {translate("Bulk Add")}
              </Button>
            )}
            <Button
              icon={<Plus className="size-4" />}
              onClick={onAddConnection}
            >
              {isOAuth ? (providerId === "iflow" ? "OAuth" : translate("Add Connection")) : translate("Add Connection")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
