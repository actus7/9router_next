import type { ImgHTMLAttributes } from "react";

interface DynamicMediaProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string;
}

function isSupportedMediaSource(src: string): boolean {
  return (
    (src.startsWith("/") && !src.startsWith("//")) ||
    src.startsWith("https://") ||
    src.startsWith("http://") ||
    src.startsWith("blob:") ||
    src.startsWith("data:image/")
  );
}

/**
 * Native media escape hatch for blob/data URLs and runtime provider output.
 * Static local assets must continue to use next/image. This component never
 * forwards untrusted runtime URLs to the Next.js image optimizer.
 */
function DynamicMedia({ src, alt, loading = "lazy", decoding = "async", ...props }: DynamicMediaProps) {
  if (!isSupportedMediaSource(src)) return null;

  // eslint-disable-next-line @next/next/no-img-element -- documented runtime-media boundary above
  return <img src={src} alt={alt} loading={loading} decoding={decoding} referrerPolicy="no-referrer" {...props} />;
}

export { DynamicMedia, isSupportedMediaSource };
