"use client";

import {
  OAuthModal,
  KiroOAuthWrapper,
  CursorAuthModal,
  GitLabAuthModal,
} from "@/shared/components";
import type { ProviderInfo } from "../../types";

interface OAuthModalSelectorProps {
  providerId: string;
  providerInfo: ProviderInfo;
  isOpen: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

export default function OAuthModalSelector({
  providerId,
  providerInfo,
  isOpen,
  onSuccess,
  onClose,
}: OAuthModalSelectorProps) {
  if (providerId === "kiro") {
    return (
      <KiroOAuthWrapper
        isOpen={isOpen}
        providerInfo={providerInfo}
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );
  }
  if (providerId === "cursor") {
    return (
      <CursorAuthModal
        isOpen={isOpen}
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );
  }
  if (providerId === "gitlab") {
    return (
      <GitLabAuthModal
        isOpen={isOpen}
        providerInfo={providerInfo}
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );
  }
  return (
    <OAuthModal
      isOpen={isOpen}
      provider={providerId}
      providerInfo={providerInfo}
      onSuccess={onSuccess}
      onClose={onClose}
    />
  );
}
