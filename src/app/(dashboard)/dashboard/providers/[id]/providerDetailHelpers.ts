"use client";

import {
  OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS,
} from "@/shared/constants/providers";
import type { ProviderInfo, ProviderNode } from "./types";

export function resolveProviderInfo(
  providerId: string,
  providerNode: ProviderNode | null,
): ProviderInfo | undefined {
  if (providerNode) {
    return {
      id: providerNode.id,
      name: providerNode.name || (providerNode.type === "anthropic-compatible" ? "Anthropic Compatible" : "OpenAI Compatible"),
      color: providerNode.type === "anthropic-compatible" ? "#D97757" : "#10A37F",
      textIcon: providerNode.type === "anthropic-compatible" ? "AC" : "OC",
      apiType: providerNode.apiType,
      baseUrl: providerNode.baseUrl,
      type: providerNode.type,
    };
  }
  return (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId] || WEB_COOKIE_PROVIDERS[providerId]) as ProviderInfo | undefined;
}

export function resolveAuthModes(
  providerId: string,
  providerInfo: ProviderInfo | undefined,
  isCompatible: boolean,
) {
  const authModes: string[] = (providerInfo?.authModes as string[] | undefined) || [];
  const isOAuth = !!OAUTH_PROVIDERS[providerId] || !!providerInfo?.hasOAuth || authModes.includes("oauth");
  const supportsApiKeyAuth = !!APIKEY_PROVIDERS[providerId] || authModes.includes("apikey");
  const isFreeNoAuth = !!(FREE_PROVIDERS[providerId] as Record<string, unknown>)?.noAuth;
  const hasDualAuthModes = !isCompatible && isOAuth && supportsApiKeyAuth;
  return { isOAuth, supportsApiKeyAuth, isFreeNoAuth, hasDualAuthModes };
}

export function resolveConnectionLabels(providerId: string) {
  const oauthConnectionLabel =
    providerId === "xai" ? "Grok Build OAuth"
    : providerId === "grok-cli" ? "Grok CLI Device Login"
    : providerId === "kimi" ? "Kimi Coding OAuth"
    : "OAuth";
  const apiKeyConnectionLabel =
    providerId === "xai" ? "xAI API Key"
    : providerId === "kimi" ? "Kimi API Key"
    : providerId === "qoder" ? "PAT"
    : "API Key";
  return { oauthConnectionLabel, apiKeyConnectionLabel };
}
