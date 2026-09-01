"use client";

import { Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { Cookie, Key, ListPlus, Lock, Plus } from "lucide-react";

interface ConnectionsBottomActionsProps {
  providerId: string;
  isCompatible: boolean;
  hasDualAuthModes: boolean;
  isOAuth: boolean;
  oauthConnectionLabel: string;
  apiKeyConnectionLabel: string;
  onTriggerOAuth: () => void;
  onTriggerApiKey: () => void;
  onAddConnection: () => void;
  onShowIFlowCookie: () => void;
  onShowBulkImportCodex: () => void;
}

export default function ConnectionsBottomActions({
  providerId,
  isCompatible,
  hasDualAuthModes,
  isOAuth: _isOAuth,
  oauthConnectionLabel,
  apiKeyConnectionLabel,
  onTriggerOAuth,
  onTriggerApiKey,
  onAddConnection,
  onShowIFlowCookie,
  onShowBulkImportCodex,
}: ConnectionsBottomActionsProps) {
  if (isCompatible) return null;
  if (providerId !== "iflow" && providerId !== "codex" && !hasDualAuthModes) return null;

  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:flex">
      {providerId === "iflow" && (
        <Button
          icon={<Cookie className="size-4" />}
          variant="secondary"
          onClick={onShowIFlowCookie}
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
          onClick={onShowBulkImportCodex}
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
            onClick={onTriggerOAuth}
            className="w-full sm:w-auto"
          >
            {oauthConnectionLabel}
          </Button>
          <Button
            icon={<Key className="size-4" />}
            onClick={onTriggerApiKey}
            className="w-full sm:w-auto"
          >
            {apiKeyConnectionLabel}
          </Button>
        </>
      ) : (
        <Button
          icon={<Plus className="size-4" />}
          onClick={onAddConnection}
          className="w-full sm:w-auto"
        >
          Add
        </Button>
      )}
    </div>
  );
}
