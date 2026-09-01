"use client";

import { Card } from "@/shared/components";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Copy, History, Info, Loader2, Save, TriangleAlert } from "lucide-react";

interface ToolActionCapability {
  execute: () => void;
  disabled: boolean;
  loading: boolean;
}

export interface ToolCardCapabilities {
  manualConfig: { execute: () => void };
  installGuide?: {
    expanded: boolean;
    toggle: () => void;
    content: React.ReactNode;
  };
  apply: ToolActionCapability;
  reset: ToolActionCapability;
}

interface ToolCardShellProps {
  /** Image src for the tool icon */
  iconSrc: string;
  /** Tool display name */
  toolName: string;
  /** Tool description text */
  toolDescription?: string;
  /** Configuration status for the badge */
  configStatus: "configured" | "not_configured" | "other" | null;
  /** Whether the card is expanded */
  isExpanded: boolean;
  /** Toggle expand/collapse */
  onToggle: () => void;
  /** Whether a status check is in progress */
  checking: boolean;
  /** Label shown while checking (e.g. "Checking Cline...") */
  checkingLabel: string;
  /** Whether the tool is installed */
  installed: boolean | undefined;
  /** Main message shown in the not-installed warning */
  notInstalledMessage: string;
  /** Optional detail text in the not-installed warning */
  notInstalledDetail?: string;
  /** Optional rich content rendered inside the not-installed warning (below detail) */
  notInstalledChildren?: React.ReactNode;
  /** Form content rendered when the tool is installed and expanded */
  children?: React.ReactNode;
  /** Current success/error message */
  message: { type: "success" | "error"; text: string } | null;
  /** Typed description of the operations supported by this tool card. */
  capabilities: ToolCardCapabilities;
}

export default function ToolCardShell({
  iconSrc,
  toolName,
  toolDescription,
  configStatus,
  isExpanded,
  onToggle,
  checking,
  checkingLabel,
  installed,
  notInstalledMessage,
  notInstalledDetail,
  notInstalledChildren,
  children,
  message,
  capabilities,
}: ToolCardShellProps) {
  return (
    <Card padding="xs" className="overflow-hidden">
      {/* ── Header ── */}
      <button type="button" className="flex min-h-11 w-full items-start justify-between gap-3 text-left sm:items-center" onClick={onToggle} aria-expanded={isExpanded}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image
              src={iconSrc}
              alt={toolName}
              width={32}
              height={32}
              className="size-8 object-contain rounded-lg"
              sizes="32px"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{toolName}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-success text-success-foreground dark:text-success-foreground rounded-full">Connected</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-warning text-warning-foreground dark:text-warning-foreground rounded-full">Not configured</span>}
              {configStatus === "other" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-info text-info-foreground dark:text-info-foreground rounded-full">Other</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{toolDescription}</p>
          </div>
        </div>
        <ChevronDown aria-hidden="true" className={`size-5 text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </button>

      {/* ── Expanded content ── */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {/* Checking spinner */}
          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <Loader2 className="size-4" />
              <span>{checkingLabel}</span>
            </div>
          )}

          {/* Not-installed warning */}
          {!checking && installed === false && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-warning border border-warning-border rounded-lg">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="size-4" />
                  <div className="flex-1">
                    <p className="font-medium text-warning-foreground dark:text-warning-foreground">{notInstalledMessage}</p>
                    {notInstalledDetail && <p className="text-sm text-text-muted">{notInstalledDetail}</p>}
                    {notInstalledChildren}
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={capabilities.manualConfig.execute}>
                    <Copy className="size-5" />
                    Manual Config
                  </Button>
                  {capabilities.installGuide && (
                    <Button variant="outline" size="sm" onClick={capabilities.installGuide.toggle}>
                      {capabilities.installGuide.expanded ? <ChevronUp className="size-4 mr-1" /> : <Info className="size-4 mr-1" />}
                      {capabilities.installGuide.expanded ? "Hide" : "How to Install"}
                    </Button>
                  )}
                </div>
              </div>
              {capabilities.installGuide?.expanded && (
                <div className="p-4 bg-surface border border-border rounded-lg">
                  <h4 className="font-medium mb-3">Installation Guide</h4>
                  {capabilities.installGuide.content}
                </div>
              )}
            </div>
          )}

          {/* Installed form content */}
          {!checking && installed && children}

          {/* Message */}
          {message && (
            <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground"}`}>
              {message.type === "success" ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
              <span>{message.text}</span>
            </div>
          )}

          {/* Action buttons */}
          {!checking && installed && (
            <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
              <Button variant="primary" size="sm" onClick={capabilities.apply.execute} disabled={capabilities.apply.disabled} loading={capabilities.apply.loading}>
                <Save className="size-4" />Apply
              </Button>
              <Button variant="outline" size="sm" onClick={capabilities.reset.execute} disabled={capabilities.reset.disabled} loading={capabilities.reset.loading}>
                <History className="size-4" />Reset
              </Button>
              <Button variant="ghost" size="sm" onClick={capabilities.manualConfig.execute}>
                <Copy className="size-4" />Manual Config
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
