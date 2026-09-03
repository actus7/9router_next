"use client";

import { Plus, Download } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { translate } from "@/i18n/runtime";

interface ChatCommandsMenuProps {
  disabled: boolean;
  onExport: (format: "json" | "markdown") => void;
}

const COMING_SOON_COMMANDS = ["compact", "feedback", "goal", "permission"] as const;

/** The "+" command palette, separate from the attach-file button — lists session-level actions. */
export default function ChatCommandsMenu({ disabled, onExport }: ChatCommandsMenuProps) {
  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        aria-label={translate("Commands") || "Commands"}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <Plus className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <button type="button" onClick={() => onExport("markdown")} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted">
          <Download className="size-3.5" />
          {translate("Export as Markdown") || "Export as Markdown"}
        </button>
        <button type="button" onClick={() => onExport("json")} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted">
          <Download className="size-3.5" />
          {translate("Export as JSON") || "Export as JSON"}
        </button>
        <div className="my-1 border-t border-border" />
        {COMING_SOON_COMMANDS.map((command) => (
          <div key={command} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-muted-foreground/50 capitalize cursor-not-allowed" title={translate("Coming soon") || "Coming soon"}>
            {command}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
