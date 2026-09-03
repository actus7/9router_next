"use client";

import {
  AI_PROVIDERS,
  resolveProviderAuthContext,
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
  return AI_PROVIDERS[providerId] as ProviderInfo | undefined;
}

export function resolveAuthModes(
  providerId: string,
  providerInfo: ProviderInfo | undefined,
  isCompatible: boolean,
) {
  return resolveProviderAuthContext(providerId, providerInfo as Parameters<typeof resolveProviderAuthContext>[1], { isCompatible });
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
