"use client";

import { Card, Button } from "@/shared/components";
import Image from "next/image";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Copy, History, Info, Loader2, Save, TriangleAlert } from "lucide-react";

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
  /** Callback for the Manual Config button in not-installed state */
  onManualConfig: () => void;
  /** Whether the install guide toggle is available */
  hasInstallGuide?: boolean;
  /** Whether the install guide is currently shown */
  showInstallGuide?: boolean;
  /** Toggle install guide visibility */
  onToggleInstallGuide?: () => void;
  /** Content of the install guide */
  installGuideContent?: React.ReactNode;
  /** Form content rendered when the tool is installed and expanded */
  children?: React.ReactNode;
  /** Current success/error message */
  message: { type: "success" | "error"; text: string } | null;
  /** Apply button handler */
  onApply: () => void;
  /** Whether the Apply button is disabled */
  applyDisabled: boolean;
  /** Whether the Apply action is in progress */
  applyLoading: boolean;
  /** Reset button handler */
  onReset: () => void;
  /** Whether the Reset button is disabled */
  resetDisabled: boolean;
  /** Whether the Reset action is in progress */
  resetLoading: boolean;
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
  onManualConfig,
  hasInstallGuide,
  showInstallGuide,
  onToggleInstallGuide,
  installGuideContent,
  children,
  message,
  onApply,
  applyDisabled,
  applyLoading,
  onReset,
  resetDisabled,
  resetLoading,
}: ToolCardShellProps) {
  return (
    <Card padding="xs" className="overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
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
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">Connected</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">Not configured</span>}
              {configStatus === "other" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">Other</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{toolDescription}</p>
          </div>
        </div>
        <ChevronDown className={`size-5 text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </div>

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
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="size-4" />
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">{notInstalledMessage}</p>
                    {notInstalledDetail && <p className="text-sm text-text-muted">{notInstalledDetail}</p>}
                    {notInstalledChildren}
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={onManualConfig} className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30">
                    <Copy className="size-5" />
                    Manual Config
                  </Button>
                  {hasInstallGuide && onToggleInstallGuide && (
                    <Button variant="outline" size="sm" onClick={onToggleInstallGuide}>
                      {showInstallGuide ? <ChevronUp className="size-4 mr-1" /> : <Info className="size-4 mr-1" />}
                      {showInstallGuide ? "Hide" : "How to Install"}
                    </Button>
                  )}
                </div>
              </div>
              {showInstallGuide && installGuideContent && (
                <div className="p-4 bg-surface border border-border rounded-lg">
                  <h4 className="font-medium mb-3">Installation Guide</h4>
                  {installGuideContent}
                </div>
              )}
            </div>
          )}

          {/* Installed form content */}
          {!checking && installed && children}

          {/* Message */}
          {message && (
            <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
              {message.type === "success" ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
              <span>{message.text}</span>
            </div>
          )}

          {/* Action buttons */}
          {!checking && installed && (
            <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
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
          )}
        </div>
      )}
    </Card>
  );
}
