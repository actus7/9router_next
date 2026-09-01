"use client";

import { NoAuthProxyCard } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { ChevronDown, Key } from "lucide-react";
import type { ProviderInfo } from "../../types";

interface OptionalKeyToggleProps {
  isFreeNoAuth: boolean;
  providerInfo: ProviderInfo;
  showOptionalKeySection: boolean;
  onShow: () => void;
}

export function OptionalKeyToggle({ isFreeNoAuth, providerInfo, showOptionalKeySection, onShow }: OptionalKeyToggleProps) {
  if (!isFreeNoAuth || showOptionalKeySection || providerInfo?.authType !== "apikey") return null;
  return (
    <button
      type="button"
      onClick={onShow}
      className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-border-subtle bg-surface px-4 py-3 text-left text-sm text-text-muted transition-colors hover:border-primary/40 hover:text-primary"
    >
      <span className="flex items-center gap-2">
        <Key className="size-4" />
        {translate("Add your own API key")}
        <span className="text-xs font-normal opacity-70">({translate("optional — for priority queue access")})</span>
      </span>
      <ChevronDown className="size-4 -rotate-90" />
    </button>
  );
}

interface FreeNoAuthSectionProps {
  isFreeNoAuth: boolean;
  providerId: string;
  providerInfo: ProviderInfo;
  showOptionalKeySection: boolean;
  onShowOptionalKey: () => void;
}

export function FreeNoAuthSection({ isFreeNoAuth, providerId, providerInfo, showOptionalKeySection, onShowOptionalKey }: FreeNoAuthSectionProps) {
  if (!isFreeNoAuth) return null;
  return (
    <>
      <NoAuthProxyCard providerId={providerId} />
      <OptionalKeyToggle isFreeNoAuth={isFreeNoAuth} providerInfo={providerInfo} showOptionalKeySection={showOptionalKeySection} onShow={onShowOptionalKey} />
    </>
  );
}
