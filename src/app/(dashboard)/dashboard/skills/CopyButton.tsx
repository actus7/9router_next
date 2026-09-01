"use client";

import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";

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
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied!" : label}
    </Button>
  );
}
