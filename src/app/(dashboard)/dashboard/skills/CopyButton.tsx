"use client";

import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Button from "@/shared/components/Button";

export function CopyButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return (
    <Button
      variant="default"
      size="xs"
      onClick={() => copy(value)}
      title={value}
      className="shrink-0"
    >
      <span className="material-symbols-outlined text-[12px]">
        {copied ? "check" : "content_copy"}
      </span>
      {copied ? "Copied!" : label}
    </Button>
  );
}
