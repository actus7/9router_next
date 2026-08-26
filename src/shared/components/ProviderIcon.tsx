"use client";

import { getProviderIconSrc, markProviderIconMissing } from "@/shared/utils/providerIcon";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

function resolveSrc(src?: string | null, providerId?: string): string | null {
  if (providerId) return getProviderIconSrc(providerId);
  if (!src) return null;
  const m = String(src).match(/^\/providers\/([^/]+)\.png$/i);
  if (m) return getProviderIconSrc(m[1]);
  return src;
}

interface ProviderIconProps {
  src?: string | null;
  providerId?: string;
  alt?: string;
  size?: number;
  className?: string;
  fallbackText?: string;
  fallbackColor?: string;
}

export default function ProviderIcon({
  src,
  providerId,
  alt,
  size = 32,
  className = "",
  fallbackText = "?",
  fallbackColor,
}: ProviderIconProps) {
  const effectiveSrc = resolveSrc(src, providerId);

  const handleError = () => {
    const m = effectiveSrc?.match(/^\/providers\/([^/]+)\.png$/i);
    if (m) markProviderIconMissing(m[1]);
    if (providerId) markProviderIconMissing(providerId);
  };

  return (
    <Avatar
      className={className}
      style={{ width: size, height: size }}
    >
      <AvatarImage
        src={effectiveSrc ?? undefined}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={handleError}
      />
      <AvatarFallback
        className="font-bold"
        style={{
          color: fallbackColor,
          fontSize: Math.max(10, Math.floor(size * 0.38)),
        }}
      >
        {fallbackText}
      </AvatarFallback>
    </Avatar>
  );
}
