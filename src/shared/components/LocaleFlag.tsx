import { Globe } from "lucide-react";
import { getLocaleFlagSrc } from "@/shared/constants/locales";

interface LocaleFlagProps {
  locale: string;
  className?: string;
}

/**
 * 3:2 flag for a locale. Plain `<img>` rather than `next/image`: these are
 * 150-byte to 3KB static SVGs, so there is nothing to optimize and no layout
 * shift to guard against.
 */
export default function LocaleFlag({ locale, className = "h-4 w-6" }: LocaleFlagProps) {
  const src = getLocaleFlagSrc(locale);
  if (!src) return <Globe className={`${className} text-text-muted`} aria-hidden="true" />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={24}
      height={16}
      className={`${className} shrink-0 rounded-[2px] object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.12)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.14)]`}
    />
  );
}
