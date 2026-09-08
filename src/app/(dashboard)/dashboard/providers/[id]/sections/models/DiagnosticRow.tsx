"use client";

import { useState, type ComponentType } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ModelDiagnostic } from "../../types";
import { diagnosticBadge, diagnosticStyle } from "./diagnosticStates";

/**
 * Something a row offers to do about one model.
 *
 * Actions are data rather than JSX so a row does not grow a branch per button:
 * whether a model can be deleted, for instance, is decided once by the caller
 * that knows which models are custom, not by markup buried three levels down.
 */
export interface DiagnosticAction {
  id: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  run: () => Promise<void>;
  /** Renders as destructive. For anything that removes a model. */
  danger?: boolean;
}

interface DiagnosticRowProps {
  result: ModelDiagnostic;
  actions?: readonly DiagnosticAction[];
}

export default function DiagnosticRow({ result, actions = [] }: DiagnosticRowProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const style = diagnosticStyle(result);
  const badge = diagnosticBadge(result);
  const { Icon } = style;

  const runAction = async (action: DiagnosticAction): Promise<void> => {
    if (busyAction) return;
    setBusyAction(action.id);
    try {
      await action.run();
    } finally {
      // The row may already be gone — disable and delete drop it from the list.
      setBusyAction(null);
    }
  };

  return (
    <div className={`rounded-lg border px-3 py-2 ${style.tone}`}>
      <div className="flex items-center gap-2">
        <Icon className={`size-4 shrink-0 ${style.spin ? "animate-spin" : ""}`} />
        <code className="truncate text-xs font-mono text-foreground">{result.modelId}</code>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {badge && <span className="text-[10px] opacity-80">{badge}</span>}
          {actions.map((action) => (
            <Button
              key={action.id}
              size="sm"
              variant="ghost"
              disabled={busyAction !== null}
              onClick={() => void runAction(action)}
              className={`h-7 gap-1 px-2 text-[11px] ${action.danger ? "text-destructive hover:text-destructive" : ""}`}
            >
              {busyAction === action.id
                ? <Loader2 className="size-3 animate-spin" />
                : <action.Icon className="size-3" />}
              {action.label}
            </Button>
          ))}
        </div>
      </div>
      {result.error && <p className="mt-1 text-xs opacity-80 break-words">{result.error}</p>}
    </div>
  );
}
