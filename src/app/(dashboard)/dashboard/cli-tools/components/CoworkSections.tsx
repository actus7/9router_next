"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { X } from "lucide-react";

interface Plugin { name: string; title?: string; oauth?: boolean; toolNames?: string[]; }
interface CustomPlugin { name: string; url: string; transport?: string; custom?: boolean; }
interface LocalPlugin { name: string; title?: string; description?: string; extensionUrl?: string; }

// ── MCP Plugins Section ──

interface McpPluginsSectionProps {
  plugins: Plugin[];
  customPlugins: CustomPlugin[];
  onRemovePlugin: (name: string) => void;
  onRemoveCustomPlugin: (name: string) => void;
  onOpenMarketplace: () => void;
  onOpenAddMcp: () => void;
}

export function McpPluginsSection({
  plugins, customPlugins, onRemovePlugin, onRemoveCustomPlugin, onOpenMarketplace, onOpenAddMcp,
}: McpPluginsSectionProps) {
  const nonExaPlugins = plugins.filter((p) => p.name !== "exa");
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
      <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-2">MCP</span>
      <span className="inline-flex items-center justify-center size-4 text-text-muted">→</span>
      <div className="flex-1 flex flex-col gap-1">
        {nonExaPlugins.map((p) => (
          <div key={p.name} className="flex items-center gap-2 px-2 py-1 bg-surface rounded border border-border">
            <span className="text-xs font-medium min-w-0 truncate flex-shrink-0">{p.title || p.name}</span>
            {p.oauth && <span className="text-[8px] text-warning-foreground shrink-0">OAuth</span>}
            <div className="flex-1 flex flex-wrap gap-1 overflow-hidden" style={{ maxHeight: "1.5rem" }}>
              {Array.isArray(p.toolNames) && p.toolNames.slice(0, 6).map((t) => (
                <span key={t} className="text-[9px] px-1 py-0.5 rounded bg-black/5 dark:bg-white/5 text-text-muted whitespace-nowrap">{t}</span>
              ))}
              {Array.isArray(p.toolNames) && p.toolNames.length > 6 && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-black/5 dark:bg-white/5 text-text-muted whitespace-nowrap">+{p.toolNames.length - 6}</span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => onRemovePlugin(p.name)} className="shrink-0 hover:text-destructive-foreground ml-auto p-0 h-auto">
              <X className="size-3" />
            </Button>
          </div>
        ))}
        {customPlugins.map((p) => (
          <div key={p.name} className="flex items-center gap-2 px-2 py-1 bg-surface rounded border border-border">
            <span className="text-xs font-medium min-w-0 truncate flex-shrink-0">{p.name}</span>
            <span className="text-[8px] px-1 py-0.5 rounded bg-info text-info-foreground shrink-0">custom</span>
            <span className="flex-1 text-[9px] text-text-muted truncate">{p.url}</span>
            <Button variant="ghost" size="sm" onClick={() => onRemoveCustomPlugin(p.name)} className="shrink-0 hover:text-destructive-foreground ml-auto p-0 h-auto">
              <X className="size-3" />
            </Button>
          </div>
        ))}
        {nonExaPlugins.length === 0 && customPlugins.length === 0 && (
          <div className="px-2 py-1.5 bg-surface rounded border border-border text-xs text-text-muted">No MCPs added</div>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <Button variant="outline" size="sm" onClick={onOpenMarketplace}>+ Browse</Button>
          <Button variant="outline" size="sm" onClick={onOpenAddMcp}>+ Custom</Button>
          <a href="https://mcp.so" target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-muted hover:text-primary underline ml-auto">Find MCPs →</a>
        </div>
      </div>
    </div>
  );
}

// ── Tools Section ──

interface ToolsSectionProps {
  plugins: Plugin[];
  localPlugins: string[];
  defaultPlugins: Plugin[];
  localStdioPlugins: LocalPlugin[];
  onPluginsChange: (plugins: Plugin[]) => void;
  onLocalPluginsChange: (plugins: string[]) => void;
}

export function ToolsSection({
  plugins, localPlugins, defaultPlugins, localStdioPlugins, onPluginsChange, onLocalPluginsChange,
}: ToolsSectionProps) {
  const exaEnabled = plugins.some((p) => p.name === "exa");
  const exaDef = defaultPlugins.find((d) => d.name === "exa");
  const browserDef = localStdioPlugins.find((p) => p.name === "browsermcp");
  const browserEnabled = localPlugins.includes("browsermcp");

  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
      <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">Tools</span>
      <span className="inline-flex items-center justify-center size-4 text-text-muted">→</span>
      <div className="flex-1 flex flex-col gap-1.5">
        <Label className="flex items-start gap-2 cursor-pointer px-2 py-1.5 bg-surface rounded border border-border">
          <Checkbox
            checked={exaEnabled}
            onCheckedChange={(checked) => {
              if (checked && exaDef) onPluginsChange([...plugins.filter((p) => p.name !== "exa"), exaDef]);
              else onPluginsChange(plugins.filter((p) => p.name !== "exa"));
            }}
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium">Web Search & Fetch (Exa)</div>
            <p className="text-[10px] text-text-muted leading-snug">Replaces built-in WebSearch/WebFetch. Auto-strips duplicates from tool list.</p>
          </div>
        </Label>
        {browserDef && (
          <Label className="flex items-start gap-2 cursor-pointer px-2 py-1.5 bg-surface rounded border border-border">
            <Checkbox
              checked={browserEnabled}
              onCheckedChange={(checked) => onLocalPluginsChange(checked ? [...localPlugins, "browsermcp"] : localPlugins.filter((n) => n !== "browsermcp"))}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium">Browser Control (Browser MCP)</div>
              <p className="text-[10px] text-text-muted leading-snug">
                Controls your running Chrome. Auto-strips Cowork&apos;s built-in browser tools.{" "}
                <a href={browserDef.extensionUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Install Chrome extension</a>
              </p>
            </div>
          </Label>
        )}
      </div>
    </div>
  );
}

// ── Local Plugins Section ──

interface LocalPluginsSectionProps {
  localStdioPlugins: LocalPlugin[];
  localPlugins: string[];
  onLocalPluginsChange: (plugins: string[]) => void;
}

export function LocalPluginsSection({ localStdioPlugins, localPlugins, onLocalPluginsChange }: LocalPluginsSectionProps) {
  const filteredPlugins = localStdioPlugins.filter((p) => p.name !== "browsermcp");
  if (filteredPlugins.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
      <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">Local Plugins</span>
      <span className="inline-flex items-center justify-center size-4 text-text-muted">→</span>
      <div className="flex-1 flex flex-col gap-2">
        <div className="flex flex-col gap-1.5 px-2 py-1.5 bg-surface rounded border border-border">
          {filteredPlugins.map((p) => {
            const enabled = localPlugins.includes(p.name);
            return (
              <Label key={p.name} className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={enabled}
                  onCheckedChange={(checked) => onLocalPluginsChange(checked ? [...localPlugins, p.name] : localPlugins.filter((n) => n !== p.name))}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium">{p.title}</span>
                    <span className="text-[8px] text-warning-foreground">stdio</span>
                  </div>
                  <p className="text-[10px] text-text-muted leading-snug">{p.description}</p>
                  {p.extensionUrl && (
                    <a href={p.extensionUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary underline">Install Chrome extension</a>
                  )}
                </div>
              </Label>
            );
          })}
        </div>
        <p className="text-[10px] text-text-muted leading-snug">
          ⚠️ Local plugins run as subprocess via <code className="px-1 py-0.5 rounded bg-black/5 dark:bg-white/5">npx</code>. Requires Node.js installed.
        </p>
      </div>
    </div>
  );
}

// ── Add Custom MCP Modal ──

interface AddMcpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (plugin: CustomPlugin) => void;
}

export function AddMcpModal({ isOpen, onClose, onAdd }: AddMcpModalProps) {
  const [form, setForm] = useState<{ name: string; url: string }>({ name: "", url: "" });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-5 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Add Custom MCP</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose} className="text-text-muted hover:text-text-main">
            <X className="size-5" />
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-text-muted">Name</Label>
            <Input
              type="text"
              placeholder="my-mcp"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value.replace(/\s+/g, "-").toLowerCase() }))}
              className="px-2 py-1.5 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-text-muted">SSE URL</Label>
            <Input
              type="text"
              placeholder="https://your-mcp-server.com/sse"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              className="px-2 py-1.5 text-xs"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const name = form.name.trim();
              if (!name || !form.url.trim()) return;
              onAdd({ name, url: form.url.trim(), transport: "sse", custom: true });
              setForm({ name: "", url: "" });
              onClose();
            }}
            size="sm"
          >Add</Button>
        </div>
      </div>
    </div>
  );
}
