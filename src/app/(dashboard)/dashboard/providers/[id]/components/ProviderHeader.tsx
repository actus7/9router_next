"use client";

import Link from "next/link";
import Image from "next/image";
import { getProviderIconSrc, markProviderIconMissing } from "@/shared/utils/providerIcon";
import { translate } from "@/i18n/runtime";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { ProviderInfo } from "../types";

interface ProviderHeaderProps {
  providerInfo: ProviderInfo;
  connectionCount: number;
  isOpenAICompatible: boolean;
  isAnthropicCompatible: boolean;
  headerImgError: boolean;
  setHeaderImgError: (error: boolean) => void;
}

export default function ProviderHeader({
  providerInfo,
  connectionCount,
  isOpenAICompatible,
  isAnthropicCompatible,
  headerImgError,
  setHeaderImgError,
}: ProviderHeaderProps) {
  const getHeaderIconPath = () => {
    if (isOpenAICompatible && providerInfo.apiType) {
      return providerInfo.apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
    }
    if (isAnthropicCompatible) {
      return "/providers/anthropic-m.png";
    }
    return getProviderIconSrc(providerInfo.id);
  };

  return (
    <div className="min-w-0 px-1 py-1 sm:px-0">
      <Link
        href="/dashboard/providers"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-primary"
      >
        <ArrowLeft className="size-4" />
        {translate("Back to Providers")}
      </Link>
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-white/10"
          style={{ backgroundColor: `${providerInfo.color}15` }}
        >
          {headerImgError || !getHeaderIconPath() ? (
            <span className="text-sm font-bold" style={{ color: providerInfo.color }}>
              {providerInfo.textIcon || providerInfo.id.slice(0, 2).toUpperCase()}
            </span>
          ) : (
            <Image
              src={getHeaderIconPath() || ""}
              alt={providerInfo.name}
              width={44}
              height={44}
              className="max-h-11 max-w-11 rounded-lg object-contain"
              sizes="44px"
              onError={() => {
                markProviderIconMissing(providerInfo.id);
                setHeaderImgError(true);
              }}
              loading="lazy"
              decoding="async"
            />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{providerInfo.name}</h1>
            {(providerInfo.notice?.apiKeyUrl || providerInfo.notice?.signupUrl || providerInfo.website) && (
              <a
                href={providerInfo.notice?.apiKeyUrl || providerInfo.notice?.signupUrl || providerInfo.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink className="size-4" />
                {providerInfo.notice?.apiKeyUrl ? translate("Get API Key") : translate("Sign up / Learn more")}
              </a>
            )}
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {connectionCount} connection{connectionCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </div>
  );
}
