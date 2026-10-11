"use client";

import { cn } from "@/lib/utils";
import { Image as ImageIcon } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { PxPipeInfo } from "./types";

interface Props {
  pxpipe: PxPipeInfo;
}

function t(text: string): string {
  return translate(text) || text;
}

export default function PxPipePanel({ pxpipe }: Props) {
  return (
    <div className="rounded-lg border border-black/5 dark:border-white/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <ImageIcon className="size-5" />
        <span className="font-semibold text-sm text-text-main">PXPIPE</span>
        <span className={cn(
          "text-xs px-2 py-0.5 rounded",
          pxpipe.applied
            ? "bg-success text-success-foreground"
            : "bg-warning text-warning-foreground"
        )}>
          {pxpipe.applied ? t("Applied") : t("Skipped")}
        </span>
      </div>
      {pxpipe.applied ? (
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <span className="text-text-muted block text-xs">{t("Original (est.)")}</span>
            <span className="font-mono">{(pxpipe.tokensBeforeEst || 0).toLocaleString()} tokens</span>
          </div>
          <div>
            <span className="text-text-muted block text-xs">{t("Compressed (est.)")}</span>
            <span className="font-mono">{(pxpipe.tokensAfterEst || 0).toLocaleString()} tokens</span>
          </div>
          <div>
            <span className="text-text-muted block text-xs">{t("Saved")}</span>
            <span className="font-mono text-success">{pxpipe.savedPct || 0}%</span>
          </div>
          <div>
            <span className="text-text-muted block text-xs">{t("Images")}</span>
            <span className="font-mono">{pxpipe.imageCount || 0} ({pxpipe.durationMs || 0}ms)</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          {t("Reason")}: <span className="font-mono">{pxpipe.reason}</span>
          {pxpipe.detail ? ` — ${pxpipe.detail}` : ""}
        </p>
      )}
    </div>
  );
}
