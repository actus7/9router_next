"use client";

import { Button } from "@/shared/components";
import { Input } from "@/components/ui/input";
import ApiKeySelect from "./ApiKeySelect";

interface ApiKey { id: string; key: string; }

interface GuideStep {
  step: number;
  title: string;
  desc?: string;
  type?: string;
  value?: string;
  copyable?: boolean;
}

interface Note {
  type: string;
  text: string;
}

// ── Notes Section ──

interface NotesSectionProps {
  notes: Note[];
  cloudEnabled: boolean;
  tunnelEnabled: boolean;
}

export function NotesSection({ notes, cloudEnabled, tunnelEnabled }: NotesSectionProps) {
  if (!notes || notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 mb-4">
      {notes.map((note, index) => {
        if (note.type === "cloudCheck" && (cloudEnabled || tunnelEnabled)) return null;
        const isWarning = note.type === "warning";
        const isError = note.type === "cloudCheck" && !cloudEnabled && !tunnelEnabled;
        let bgClass = "bg-blue-500/10 border-blue-500/30";
        let textClass = "text-blue-600 dark:text-blue-400";
        let iconClass = "text-blue-500";
        let icon = "info";
        if (isWarning) {
          bgClass = "bg-yellow-500/10 border-yellow-500/30";
          textClass = "text-yellow-600 dark:text-yellow-400";
          iconClass = "text-yellow-500";
          icon = "warning";
        } else if (isError) {
          bgClass = "bg-red-500/10 border-red-500/30";
          textClass = "text-red-600 dark:text-red-400";
          iconClass = "text-red-500";
          icon = "error";
        }
        return (
          <div key={index} className={`flex items-start gap-3 p-3 rounded-lg border ${bgClass}`}>
            <span className={`text-lg ${iconClass}`}>{icon}</span>
            <p className={`text-sm ${textClass}`}>{note.text}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Model Selector for Guide Steps ──

interface GuideModelSelectorProps {
  modelValue: string;
  onModelChange: (value: string) => void;
  onOpenModelModal: () => void;
  hasActiveProviders: boolean;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
}

export function GuideModelSelector({
  modelValue, onModelChange, onOpenModelModal, hasActiveProviders, copiedField, onCopy,
}: GuideModelSelectorProps) {
  return (
    <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
      <Input
        type="text"
        value={modelValue}
        onChange={(e) => onModelChange(e.target.value)}
        placeholder="provider/model-id"
        className="w-full sm:w-auto flex-1 px-3 py-2 text-sm"
      />
      <Button variant="outline" size="sm" onClick={onOpenModelModal} disabled={!hasActiveProviders} className="shrink-0">
        Select Model
      </Button>
      {modelValue && (
        <>
          <Button variant="outline" size="icon-sm" onClick={() => onCopy(modelValue, "model")} className="shrink-0">
            <span className="text-lg">{copiedField === "model" ? "check" : "content_copy"}</span>
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onModelChange("")} className="text-text-muted hover:text-red-500" title="Clear">
            <span className="text-lg">close</span>
          </Button>
        </>
      )}
    </div>
  );
}

// ── Main GuideSteps Component ──

interface GuideStepsProps {
  guideSteps: GuideStep[];
  notes?: Note[];
  codeBlock?: { language: string; code: string };
  color?: string;
  cloudEnabled: boolean;
  tunnelEnabled: boolean;
  requiresExternalUrl?: boolean;
  requiresCloud?: boolean;
  apiKeys: ApiKey[];
  selectedApiKey: string;
  onApiKeyChange: (key: string) => void;
  modelValue: string;
  onModelChange: (value: string) => void;
  onOpenModelModal: () => void;
  hasActiveProviders: boolean;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
  replaceVars: (text: string) => string;
}

export function GuideSteps({
  guideSteps, notes, codeBlock, color, cloudEnabled, tunnelEnabled, requiresExternalUrl, requiresCloud,
  apiKeys, selectedApiKey, onApiKeyChange,
  modelValue, onModelChange, onOpenModelModal, hasActiveProviders,
  copiedField, onCopy, replaceVars,
}: GuideStepsProps) {
  const canShowGuide = () => {
    if (requiresExternalUrl && !cloudEnabled && !tunnelEnabled) return false;
    if (requiresCloud && !cloudEnabled) return false;
    return true;
  };

  const renderApiKeySelector = () => (
    <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
      <ApiKeySelect value={selectedApiKey} onChange={onApiKeyChange} apiKeys={apiKeys} cloudEnabled={cloudEnabled} className="flex-1" />
    </div>
  );

  if (!guideSteps) return <p className="text-text-muted text-sm">Coming soon...</p>;

  return (
    <div className="flex flex-col gap-4">
      {notes && <NotesSection notes={notes} cloudEnabled={cloudEnabled} tunnelEnabled={tunnelEnabled} />}
      {canShowGuide() && guideSteps.map((item) => (
        <div key={item.step} className="flex items-start gap-4">
          <div className="size-8 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold text-white" style={{ backgroundColor: color }}>
            {item.step}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-text">{item.title}</p>
            {item.desc && <p className="text-sm text-text-muted mt-0.5">{item.desc}</p>}
            {item.type === "apiKeySelector" && renderApiKeySelector()}
            {item.type === "modelSelector" && (
              <GuideModelSelector
                modelValue={modelValue}
                onModelChange={onModelChange}
                onOpenModelModal={onOpenModelModal}
                hasActiveProviders={hasActiveProviders}
                copiedField={copiedField}
                onCopy={onCopy}
              />
            )}
            {item.value && (
              <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
                <code className="w-full sm:w-auto flex-1 px-3 py-2 bg-bg-secondary rounded-lg text-sm font-mono border border-border truncate">
                  {replaceVars(item.value)}
                </code>
                {item.copyable && (
                  <Button variant="outline" size="icon-sm" onClick={() => onCopy(item.value!, `${item.step}-${item.title}`)} className="shrink-0">
                    <span className="text-lg">{copiedField === `${item.step}-${item.title}` ? "check" : "content_copy"}</span>
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}

      {canShowGuide() && codeBlock && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted uppercase tracking-wide">{codeBlock.language}</span>
            <Button variant="outline" size="sm" onClick={() => onCopy(codeBlock.code, "codeblock")} className="flex items-center gap-1">
              <span className="text-sm">{copiedField === "codeblock" ? "check" : "content_copy"}</span>
              {copiedField === "codeblock" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <pre className="p-4 bg-bg-secondary rounded-lg border border-border overflow-x-auto">
            <code className="text-sm font-mono whitespace-pre">{replaceVars(codeBlock.code)}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
