"use client";

import { cn } from "@/lib/utils";
import { Image as ImageIcon } from "lucide-react";
import type { PxPipeInfo } from "./types";

interface Props {
  pxpipe: PxPipeInfo;
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
          {pxpipe.applied ? "Ativado" : "Ignorado"}
        </span>
      </div>
      {pxpipe.applied ? (
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <span className="text-text-muted block text-xs">Original (est.)</span>
            <span className="font-mono">{(pxpipe.tokensBeforeEst || 0).toLocaleString()} tokens</span>
          </div>
          <div>
            <span className="text-text-muted block text-xs">Comprimido (est.)</span>
            <span className="font-mono">{(pxpipe.tokensAfterEst || 0).toLocaleString()} tokens</span>
          </div>
          <div>
            <span className="text-text-muted block text-xs">Economizado</span>
            <span className="font-mono text-success-foreground">{pxpipe.savedPct || 0}%</span>
          </div>
          <div>
            <span className="text-text-muted block text-xs">Imagens</span>
            <span className="font-mono">{pxpipe.imageCount || 0} ({pxpipe.durationMs || 0}ms)</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          Motivo: <span className="font-mono">{pxpipe.reason}</span>
          {pxpipe.detail ? ` — ${pxpipe.detail}` : ""}
        </p>
      )}
    </div>
  );
}
