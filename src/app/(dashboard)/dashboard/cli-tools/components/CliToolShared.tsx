"use client";

import { Button } from "@/shared/components";
import { AlertCircle, CheckCircle2, Copy, History, Save } from "lucide-react";

interface Message {
  type: "success" | "error";
  text: string;
}

/** Displays a success or error message banner. */
export function StatusMessage({ message }: { message: Message | null }) {
  if (!message) return null;
  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
      {message.type === "success" ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
      <span>{message.text}</span>
    </div>
  );
}

interface ActionButtonsProps {
  onApply: () => void;
  applyDisabled: boolean;
  applyLoading: boolean;
  onReset: () => void;
  resetDisabled: boolean;
  resetLoading: boolean;
  onManualConfig: () => void;
  /** Extra CSS classes for the container */
  className?: string;
}

/** Standard Apply / Reset / Manual Config button row. */
export function ActionButtons({
  onApply, applyDisabled, applyLoading,
  onReset, resetDisabled, resetLoading,
  onManualConfig,
  className,
}: ActionButtonsProps) {
  return (
    <div className={className ?? "grid grid-cols-1 gap-2 sm:flex sm:items-center"}>
      <Button variant="primary" size="sm" onClick={onApply} disabled={applyDisabled} loading={applyLoading}>
        <Save className="size-4" />Apply
      </Button>
      <Button variant="outline" size="sm" onClick={onReset} disabled={resetDisabled} loading={resetLoading}>
        <History className="size-4" />Reset
      </Button>
      <Button variant="ghost" size="sm" onClick={onManualConfig}>
        <Copy className="size-4" />Manual Config
      </Button>
    </div>
  );
}
