"use client";

import { ReactNode } from "react";
import { Input } from "@/shared/components";
import Button from "@/shared/components/Button";
import { Check, Copy } from "lucide-react";

interface EndpointRowProps {
  label: string;
  url: string;
  copyId: string;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
  badge?: string;
  actions?: ReactNode;
}

/** Reusable endpoint row component */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }: EndpointRowProps) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${
          (badge === "CF" || badge === "TS") ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
        }`}>{label}</span>
      <Input value={url} readOnly className="flex-1 font-mono text-sm" />
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onCopy(url, copyId)}
        className="text-text-muted hover:text-primary"
      >
        {copied === copyId ? <Check className="size-[18px]" /> : <Copy className="size-[18px]" />}
      </Button>
      {actions}
    </div>
  );
}
