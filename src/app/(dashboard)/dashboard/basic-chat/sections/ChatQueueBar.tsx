"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { QueuedMessage } from "../hooks/useSendMessageTypes";

interface ChatQueueBarProps {
  items: QueuedMessage[];
  onCancel: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
}

/** Visible queue of messages waiting to send after the current run — reorder or cancel any of them. */
export default function ChatQueueBar({ items, onCancel, onMove }: ChatQueueBarProps) {
  if (items.length === 0) return null;

  return (
    <div className="mx-auto mb-3 w-full max-w-4xl px-6">
      <div className="rounded-xl border border-border bg-card/70 p-2">
        <p className="px-1.5 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {translate("Queued") || "Na fila"} · {items.length}
        </p>
        <ol className="flex flex-col gap-1">
          {items.map((item, index) => {
            const preview = item.text || `${item.attachments.length} anexo${item.attachments.length === 1 ? "" : "s"}`;
            return (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5"
              >
                <span className="w-4 shrink-0 text-center font-mono text-[10px] text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{preview}</span>
                <button
                  type="button"
                  onClick={() => onMove(item.id, "up")}
                  disabled={index === 0}
                  aria-label={translate("Move up") || "Mover para cima"}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(item.id, "down")}
                  disabled={index === items.length - 1}
                  aria-label={translate("Move down") || "Mover para baixo"}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onCancel(item.id)}
                  aria-label={translate("Cancel") || "Cancelar"}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
