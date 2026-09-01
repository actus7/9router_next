"use client";

import { Button } from "@/components/ui/button";
import { Beaker, Bot, Check, CheckCircle2, Copy, Loader2, X } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface CardModelRowProps {
  model: { id: string; name?: string };
  fullModel: string;
  copied?: string;
  onCopy: (text: string, id: string) => void;
  testStatus?: "ok" | "error";
  isCustom?: boolean;
  isFree?: boolean;
  onDeleteAlias?: () => void;
  onTest?: () => void;
  isTesting?: boolean;
}

export default function CardModelRow({ model, fullModel, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting }: CardModelRowProps) {
  const borderColor = testStatus === "ok" ? "border-green-500/40" : testStatus === "error" ? "border-red-500/40" : "border-border";
  const iconColor = testStatus === "ok" ? "#22c55e" : testStatus === "error" ? "#ef4444" : undefined;

  return (
    <div className={`group px-3 py-2 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <div className="flex items-center gap-2">
        <span className="text-base" style={iconColor ? { color: iconColor } : undefined}>
          {testStatus === "ok" ? <CheckCircle2 className="size-4" /> : testStatus === "error" ? <X className="size-4" /> : <Bot className="size-4" />}
        </span>
        <div className="flex flex-col gap-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          {model.name && <span className="text-[9px] text-text-muted/70 italic pl-1">{model.name}</span>}
        </div>
        {onTest && (
          <div className="relative group/btn">
            <Button variant="ghost" size="icon-sm" onClick={onTest} disabled={isTesting} className={`${isTesting ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
              <span className="text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isTesting ? <Loader2 className="size-4" /> : <Beaker className="size-4" />}
              </span>
            </Button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? translate("Testing...") : translate("Test")}
            </span>
          </div>
        )}
        <div className="relative group/btn">
          <Button variant="ghost" size="icon-sm" onClick={() => onCopy(fullModel, `model-${model.id}`)}>
            <span className="text-sm">{copied === `model-${model.id}` ? <Check className="size-4" /> : <Copy className="size-4" />}</span>
          </Button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {isFree && <span className="text-[10px] font-bold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">FREE</span>}
        {isCustom && (
          <Button variant="ghost" size="icon-sm" onClick={onDeleteAlias} className="text-red-500 opacity-0 group-hover:opacity-100 ml-auto" title="Remove custom model">
            <X className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
