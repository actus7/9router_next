"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import Button from "./Button";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

interface ConfigItem {
  filename: string;
  content: string;
}

interface ManualConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  configs?: ConfigItem[];
}

export default function ManualConfigModal({ isOpen, onClose, title = "Manual Configuration", configs = [] }: ManualConfigModalProps) {
  const { copy } = useCopyToClipboard();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyConfig = (text: string, index: number) => {
    copy(text, `manualconfig-${index}`);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "bg-surface border border-border-subtle rounded-[14px]",
          "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0",
          "max-w-xl"
        )}
      >
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">
            {title}
          </DialogTitle>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-[10px] text-text-muted hover:bg-surface-2 hover:text-text-main transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-4">
        {configs.map((config, index) => (
          <div key={index} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-main">{config.filename}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyConfig(config.content, index)}
              >
                <span className="material-symbols-outlined text-[14px] mr-1">
                  {copiedIndex === index ? "check" : "content_copy"}
                </span>
                {copiedIndex === index ? "Copied!" : "Copy"}
              </Button>
            </div>
            <pre className="px-3 py-2 bg-surface-2/50 rounded font-mono text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-60 overflow-y-auto border border-border">
              {config.content}
            </pre>
          </div>
        ))}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
