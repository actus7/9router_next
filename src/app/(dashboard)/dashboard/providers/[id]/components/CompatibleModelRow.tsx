"use client";

import { Button } from "@/components/ui/button";
import { Beaker, Bot, Check, CheckCircle2, Copy, Loader2, Trash2, X } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface CompatibleModelRowProps {
  modelId: string;
  fullModel: string;
  copied?: string;
  onCopy: (text: string, id: string) => void;
  onDeleteAlias: () => void;
  onTest?: () => void;
  testStatus?: "ok" | "error";
  isTesting?: boolean;
}

export default function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting }: CompatibleModelRowProps) {
  const borderColor = testStatus === "ok" ? "border-success-border" : testStatus === "error" ? "border-destructive-border" : "border-border";
  const iconColor = testStatus === "ok" ? "#22c55e" : testStatus === "error" ? "#ef4444" : undefined;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <span className="text-base text-text-muted" style={iconColor ? { color: iconColor } : undefined}>
        {testStatus === "ok" ? <CheckCircle2 className="size-4" /> : testStatus === "error" ? <X className="size-4" /> : <Bot className="size-4" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{modelId}</p>
        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          <div className="relative group/btn">
            <Button variant="ghost" size="icon-xs" onClick={() => onCopy(fullModel, `model-${modelId}`)}>
              <span className="text-sm">{copied === `model-${modelId}` ? <Check className="size-4" /> : <Copy className="size-4" />}</span>
            </Button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {onTest && (
            <div className="relative group/btn">
              <Button variant="ghost" size="icon-xs" onClick={onTest} disabled={isTesting}>
                <span className="text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? <Loader2 className="size-4" /> : <Beaker className="size-4" />}
                </span>
              </Button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? translate("Testing...") : translate("Test")}
              </span>
            </div>
          )}
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={onDeleteAlias} className="text-destructive-foreground hover:bg-destructive hover:text-destructive-foreground" title="Remove model">
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
