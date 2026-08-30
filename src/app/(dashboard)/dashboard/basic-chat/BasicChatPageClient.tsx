"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/shared/components";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { getModelsByProviderId } from "@/shared/constants/models";
import { isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";
import ModelPickerModal from "@/shared/components/ModelPickerModal";
import {
  AlertCircle, ArrowUp, Check, CheckCircle2, ChevronDown, Command, Copy, Download,
  GripVertical, Hash, Keyboard, MessageSquare, PanelLeftClose, PanelLeft, Paperclip,
  Pencil, Plus, RefreshCw, Search, Settings2, Square, StopCircle, Terminal, ThumbsDown,
  ThumbsUp, Trash2, Wrench, X, Zap,
} from "lucide-react";
import { translate } from "@/i18n/runtime";
import { marked } from "marked";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import html from "highlight.js/lib/languages/xml";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Register highlight.js languages
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", html);
hljs.registerLanguage("xml", html);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", cpp);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);

const STORAGE_KEYS = {
  sessions: "basic-chat.sessions",
  activeSessionId: "basic-chat.activeSessionId",
  activeProviderId: "basic-chat.activeProviderId",
  draft: "basic-chat.draft",
  systemPrompt: "basic-chat.systemPrompt",
  temperature: "basic-chat.temperature",
  sidebarOpen: "basic-chat.sidebarOpen",
};

// Configure marked with syntax highlighting
const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
  let highlighted: string;
  try {
    highlighted = hljs.highlight(text, { language }).value;
  } catch {
    highlighted = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
};

marked.setOptions({
  breaks: true,
  gfm: true,
});
marked.use({ renderer });

function renderMarkdown(text: string): string {
  try {
    const result = marked.parse(text);
    if (typeof result === "string") return result;
    return text;
  } catch {
    return text;
  }
}

interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size?: number;
  dataUrl: string;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  status?: "pending" | "running" | "done" | "error";
}

interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string | unknown;
  attachments?: ChatAttachment[];
  createdAt?: string;
  status?: string;
  toolCalls?: ToolCall[];
  feedback?: "up" | "down" | null;
  tokenUsage?: TokenUsage;
}

interface ChatSession {
  id: string;
  title: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

interface NormalizedModel {
  id: string;
  requestModel: string;
  name: string;
  providerId: string;
  providerName: string;
  source: string;
}

interface ProviderGroup {
  providerId: string;
  providerName: string;
  providerType: string;
  connections: Array<Record<string, unknown>>;
  models: NormalizedModel[];
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeParse(value: string | null, fallback: unknown): unknown {
  try {
    return JSON.parse(value ?? "");
  } catch {
    return fallback;
  }
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function humanize(value = ""): string {
  return String(value)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || "Unknown";
}

function formatRelativeTime(value: string | undefined | null) {
  if (!value) return "Now";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Now";
  const diffMinutes = Math.max(1, Math.round((Date.now() - time) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.round(diffHours / 24)}d`;
}

const DATE_GROUP_ORDER = ["Hoje", "Ontem", "Últimos 7 dias", "Últimos 30 dias", "Anteriores"];

function getDateGroup(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const monthAgo = new Date(today.getTime() - 30 * 86400000);

  if (date >= today) return "Hoje";
  if (date >= yesterday) return "Ontem";
  if (date >= weekAgo) return "Últimos 7 dias";
  if (date >= monthAgo) return "Últimos 30 dias";
  return "Anteriores";
}

function makeSessionTitle(text = ""): string {
  const normalized = textValue(text).replace(/\s+/g, " ").trim();
  if (!normalized) return translate("New conversation") || "New conversation";
  return normalized.length > 52 ? `${normalized.slice(0, 52).trimEnd()}…` : normalized;
}

function buildUserContent(message: ChatMessage) {
  const text = textValue(message.content).trim();
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];

  if (attachments.length === 0) return text;

  const content = [];
  if (text) content.push({ type: "text", text });

  for (const attachment of attachments) {
    if (attachment?.dataUrl) {
      content.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
    }
  }

  return content.length > 0 ? content : text;
}

function readAssistantText(chunk: Record<string, unknown>): string {
  if (!chunk || typeof chunk !== "object") return "";
  const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  const delta = (choice?.delta as Record<string, unknown>) || {};
  const messageObj = choice?.message as Record<string, unknown> | undefined;
  const pieces = [delta.content, messageObj?.content, chunk.output_text, chunk.text]
    .map(textValue)
    .filter(Boolean);
  return pieces[0] || "";
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function cloneSession(session: ChatSession): ChatSession {
  return {
    ...session,
    messages: Array.isArray(session.messages) ? session.messages.map((message) => ({ ...message })) : [],
  };
}

function getProviderLabel(connection: Record<string, unknown>): string {
  return (connection?.name as string) || humanize((connection?.provider as string) || (connection?.id as string) || "provider");
}

function normalizeStaticModel(model: Record<string, unknown>, connection: Record<string, unknown>): NormalizedModel | null {
  if (!model?.id) return null;
  return {
    id: `${connection.provider}/${model.id}`,
    requestModel: `${connection.provider}/${model.id}`,
    name: (model.name as string) || (model.id as string),
    providerId: connection.provider as string,
    providerName: getProviderLabel(connection),
    source: "static",
  };
}

function normalizeLiveModel(model: string | Record<string, unknown>, connection: Record<string, unknown>): NormalizedModel | null {
  const rawId = typeof model === "string" ? model : (model?.id as string) || (model?.name as string) || (model?.model as string) || "";
  if (!rawId) return null;

  const displayName = typeof model === "string"
    ? model
    : (model?.name as string) || (model?.displayName as string) || rawId;

  const requestModel = rawId.includes("/") ? rawId : `${connection.provider}/${rawId}`;

  return {
    id: requestModel,
    requestModel,
    name: displayName,
    providerId: connection.provider as string,
    providerName: getProviderLabel(connection),
    source: "live",
  };
}

function parseProviderModelsPayload(data: Record<string, unknown>): unknown[] {
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

function dedupeModels(models: NormalizedModel[]): NormalizedModel[] {
  const map = new Map();
  for (const model of models) {
    if (!model?.id) continue;
    if (!map.has(model.id)) map.set(model.id, model);
  }
  return Array.from(map.values());
}

// ─── Sortable session item for drag & drop ─────────────────────────────────
interface SortableSessionItemProps {
  session: ChatSession;
  isActive: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  renameValue: string;
  selectedCount: number;
  onSelect: (id: string) => void;
  onToggleSelect: (e: React.MouseEvent, id: string) => void;
  onStartRename: (e: React.MouseEvent, session: ChatSession) => void;
  onCommitRename: (id: string) => void;
  onDelete: (id: string) => void;
  onRenameChange: (value: string) => void;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
}

function SortableSessionItem({
  session, isActive, isSelected, isRenaming, renameValue, selectedCount,
  onSelect, onToggleSelect, onStartRename, onCommitRename, onDelete, onRenameChange, renameInputRef,
}: SortableSessionItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: session.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="button"
      tabIndex={0}
      onClick={() => { if (!isRenaming) onSelect(session.id); }}
      onKeyDown={(e) => { if (!isRenaming && e.key === "Enter") onSelect(session.id); }}
      className={`group flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2 text-left text-sm transition-all hover:bg-muted ${isActive ? "bg-muted" : ""} ${isDragging ? "z-50" : ""}`}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3" />
      </button>
      <button
        type="button"
        onClick={(e) => onToggleSelect(e, session.id)}
        className={`shrink-0 items-center justify-center rounded border transition-all ${
          isSelected || selectedCount > 0 ? "flex size-3.5 border-border bg-background" : "hidden group-hover:flex group-hover:size-3.5 group-hover:border-border group-hover:bg-background"
        } ${isSelected ? "border-primary bg-primary text-primary-foreground" : ""}`}
      >
        {isSelected ? <CheckCircle2 className="size-2.5" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        {isRenaming ? (
          <input ref={renameInputRef} value={renameValue} onChange={(e) => onRenameChange(e.target.value)} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") onCommitRename(session.id); if (e.key === "Escape") onCommitRename(""); }} onBlur={() => onCommitRename(session.id)} className="h-5 w-full rounded border border-border bg-background px-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
        ) : (
          <>
            <p className="truncate text-xs font-medium text-card-foreground">{session.title}</p>
            <p className="text-[10px] text-muted-foreground">{formatRelativeTime(session.updatedAt)}</p>
          </>
        )}
      </div>
      {!isRenaming && (
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon-sm" type="button" onClick={(e: React.MouseEvent) => onStartRename(e, session)} className="size-5"><Pencil className="size-2.5" /></Button>
          <Button variant="ghost" size="icon-sm" type="button" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onDelete(session.id); }} className="size-5 text-destructive hover:text-destructive"><Trash2 className="size-2.5" /></Button>
        </div>
      )}
    </div>
  );
}

export default function BasicChatPageClient() {
  const [providerGroups, setProviderGroups] = useState<ProviderGroup[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = safeParse(globalThis.localStorage.getItem(STORAGE_KEYS.sessions), []);
      return Array.isArray(saved) ? saved.map((session) => ({
        ...session,
        messages: Array.isArray(session.messages) ? session.messages : [],
      })) : [];
    } catch { return []; }
  });
  const [activeSessionId, setActiveSessionId] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.activeSessionId) || "";
  });
  const [activeProviderId, setActiveProviderId] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.activeProviderId) || "";
  });
  const [activeModelId, setActiveModelId] = useState("");
  const [draft, setDraft] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.draft) || "";
  });
  const [apiKey, setApiKey] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return globalThis.localStorage.getItem(STORAGE_KEYS.sidebarOpen) !== "false";
  });
  const [systemPrompt, setSystemPrompt] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.systemPrompt) || "";
  });
  const [temperature, setTemperature] = useState(() => {
    if (typeof window === "undefined") return 0.7;
    const saved = globalThis.localStorage.getItem(STORAGE_KEYS.temperature);
    return saved ? parseFloat(saved) : 0.7;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const initializedRef = useRef(false);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadOrCreateApiKey() {
      try {
        const res = await fetch("/api/keys", { cache: "no-store" });
        const data = await res.json().catch(() => ({})) as Record<string, unknown>;
        const keys = Array.isArray(data.keys) ? (data.keys as Array<{ key: string }>) : [];
        if (keys[0]?.key) {
          if (!cancelled) setApiKey(keys[0].key);
          return;
        }

        const created = await fetch("/api/keys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Basic Chat" }),
        });
        const createdData = await created.json().catch(() => ({})) as Record<string, unknown>;
        if (!cancelled && typeof createdData.key === "string") setApiKey(createdData.key);
      } catch {
        // Ignore — the chat request will surface a clear "Missing API key" error if this fails.
      }
    }

    loadOrCreateApiKey();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoadingData(true);
      setLoadError("");

      try {
        const providersRes = await fetch("/api/providers", { cache: "no-store" });
        const providersData = await providersRes.json().catch(() => ({})) as Record<string, unknown>;
        const connections = Array.isArray(providersData.connections)
          ? (providersData.connections as Array<Record<string, unknown>>).filter((connection) => connection?.isActive !== false)
          : [];

        if (connections.length === 0) {
          if (!cancelled) {
            setProviderGroups([]);
            setLoadError(translate("No providers connected yet.") || "No providers connected yet.");
          }
          return;
        }

        const providerMap = new Map();

        for (const connection of connections) {
          const providerId = (connection.provider as string) || (connection.id as string);
          const providerName = getProviderLabel(connection);
          const providerType = isOpenAICompatibleProvider(providerId)
            ? "openai-compatible"
            : isAnthropicCompatibleProvider(providerId)
              ? "anthropic-compatible"
              : providerId;

          if (!providerMap.has(providerId)) {
            providerMap.set(providerId, {
              providerId,
              providerName,
              providerType,
              connections: [],
              models: [],
            });
          }

          const group = providerMap.get(providerId);
          group.providerName = group.providerName || providerName;
          group.providerType = group.providerType || providerType;
          group.connections.push(connection);

          const staticModels = getModelsByProviderId(providerId)
            .map((model) => normalizeStaticModel(model, connection))
            .filter(Boolean);
          group.models.push(...staticModels);
        }

        const liveResults = await Promise.all(
          connections.map(async (connection: Record<string, unknown>) => {
            try {
              const response = await fetch(`/api/providers/${connection.id}/models`, { cache: "no-store" });
              const data = await response.json().catch(() => ({})) as Record<string, unknown>;
              if (!response.ok) return { connection, models: [] };
              const models = parseProviderModelsPayload(data)
                .map((model: unknown) => normalizeLiveModel(model as string | Record<string, unknown>, connection))
                .filter(Boolean);
              return { connection, models };
            } catch {
              return { connection, models: [] };
            }
          })
        );

        for (const result of liveResults) {
          const providerId = result.connection.provider || result.connection.id;
          const group = providerMap.get(providerId);
          if (!group) continue;
          group.models.push(...result.models);
        }

        const normalized = Array.from(providerMap.values())
          .map((group) => ({
            ...group,
            models: dedupeModels(group.models).sort((a, b) => a.name.localeCompare(b.name)),
          }))
          .filter((group) => group.models.length > 0)
          .sort((a, b) => a.providerName.localeCompare(b.providerName));

        if (!cancelled) {
          setProviderGroups(normalized);
          if (normalized.length === 0) {
            setLoadError(translate("Providers connected but no models available.") || "Providers connected but no models available.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(textValue((error as Record<string, unknown>)?.message) || (translate("Failed to load providers/models.") || "Failed to load providers/models."));
          setProviderGroups([]);
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (historyMenuRef.current && !historyMenuRef.current.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (renamingSessionId) renameInputRef.current?.focus();
  }, [renamingSessionId]);

  const modelIndex = useMemo(() => {
    const map = new Map();
    for (const group of providerGroups) {
      for (const model of group.models) {
        map.set(model.id, {
          ...model,
          providerId: group.providerId,
          providerName: group.providerName,
        });
      }
    }
    return map;
  }, [providerGroups]);

  const activeProviderGroup = useMemo(() => {
    return providerGroups.find((group) => group.providerId === activeProviderId) || providerGroups[0] || null;
  }, [providerGroups, activeProviderId]);

  const activeModel = useMemo(() => {
    if (activeModelId && modelIndex.has(activeModelId)) return modelIndex.get(activeModelId);
    if (activeSessionId) {
      const session = sessions.find((item) => item.id === activeSessionId);
      if (session?.modelId && modelIndex.has(session.modelId)) return modelIndex.get(session.modelId);
    }
    return activeProviderGroup?.models?.[0] || null;
  }, [activeModelId, modelIndex, activeProviderGroup, sessions, activeSessionId]);

  const currentSession = useMemo(() => sessions.find((session) => session.id === activeSessionId) || null, [sessions, activeSessionId]);
  const currentMessages = currentSession?.messages || [];
  const sessionItems = useMemo(() => [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [sessions]);
  const canSend = !isSending && !!activeModel && (draft.trim().length > 0 || attachments.length > 0);

  // Drag & drop sensors
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSessions((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id);
      const newIndex = prev.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const filteredSessionItems = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return sessionItems;
    return sessionItems.filter((session) => session.title.toLowerCase().includes(q));
  }, [sessionItems, historySearch]);

  const groupedSessionItems = useMemo(() => {
    const groupMap = new Map<string, ChatSession[]>();
    for (const session of filteredSessionItems) {
      const group = getDateGroup(session.updatedAt);
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(session);
    }
    return DATE_GROUP_ORDER
      .map((label) => ({ label, items: groupMap.get(label) || [] }))
      .filter((group) => group.items.length > 0);
  }, [filteredSessionItems]);

  const selectedSessionCount = selectedSessionIds.size;
  const allVisibleSessionsSelected = filteredSessionItems.length > 0 && filteredSessionItems.every((session) => selectedSessionIds.has(session.id));

  useEffect(() => {
    if (!isHydrated) return;
    try {
      globalThis.localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
      globalThis.localStorage.setItem(STORAGE_KEYS.activeSessionId, activeSessionId);
      globalThis.localStorage.setItem(STORAGE_KEYS.activeProviderId, activeProviderId);
      globalThis.localStorage.setItem(STORAGE_KEYS.draft, draft);
      globalThis.localStorage.setItem(STORAGE_KEYS.systemPrompt, systemPrompt);
      globalThis.localStorage.setItem(STORAGE_KEYS.temperature, String(temperature));
      globalThis.localStorage.setItem(STORAGE_KEYS.sidebarOpen, String(sidebarOpen));
    } catch {
      // Ignore storage errors.
    }
  }, [isHydrated, sessions, activeSessionId, activeProviderId, draft, systemPrompt, temperature, sidebarOpen]);

  useEffect(() => {
    if (!isHydrated || loadingData || initializedRef.current) return;
    if (providerGroups.length === 0) return;

    const savedProvider = providerGroups.find((group) => group.providerId === activeProviderId) || providerGroups[0];
    const savedModel = activeModelId && modelIndex.has(activeModelId)
      ? modelIndex.get(activeModelId)
      : savedProvider.models[0];

    if (sessions.length > 0) {
      const session = sessions.find((item) => item.id === activeSessionId) || sessions[0];
      const sessionModel = session?.modelId && modelIndex.has(session.modelId)
        ? modelIndex.get(session.modelId)
        : savedModel;
      initializedRef.current = true;
      setActiveSessionId(session.id);
      setActiveProviderId(sessionModel?.providerId || savedProvider.providerId);
      setActiveModelId(sessionModel?.id || savedModel.id);
      return;
    }

    const session = {
      id: createId(),
      title: translate("New conversation") || "New conversation",
      providerId: savedProvider.providerId,
      providerName: savedProvider.providerName,
      modelId: savedModel.id,
      modelName: savedModel.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };

    initializedRef.current = true;
    setSessions([session]);
    setActiveSessionId(session.id);
    setActiveProviderId(savedProvider.providerId);
    setActiveModelId(savedModel.id);
  }, [isHydrated, loadingData, providerGroups, modelIndex, sessions, activeSessionId, activeProviderId, activeModelId]);

  const updateSession = (sessionId: string, updater: (session: ChatSession) => ChatSession) => {
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? updater(cloneSession(session)) : session)));
  };

  const ensureSessionForModel = (model: NormalizedModel | null): ChatSession | undefined => {
    if (!model) return undefined;
    return {
      id: createId(),
      title: translate("New conversation") || "New conversation",
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.id,
      modelName: model.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
  };

  const handleNewChat = () => {
    if (!activeModel) return;
    const session = ensureSessionForModel(activeModel);
    if (!session) return;
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setActiveProviderId(session.providerId);
    setActiveModelId(session.modelId);
    setDraft("");
    setAttachments([]);
    setStreamingMessageId("");
    setStreamingText("");
  };

  const handleSelectSession = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    setActiveProviderId(session.providerId || activeProviderId);
    setActiveModelId(session.modelId || activeModelId);
    setHistoryOpen(false);
  };

  const handleDeleteSession = (sessionId: string) => {
    const nextSessions = sessions.filter((session) => session.id !== sessionId);
    setSessions(nextSessions);
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    if (activeSessionId === sessionId) {
      const fallback = nextSessions[0] || null;
      if (fallback) {
        setActiveSessionId(fallback.id);
        setActiveProviderId(fallback.providerId);
        setActiveModelId(fallback.modelId);
      } else {
        setActiveSessionId("");
        setActiveProviderId("");
        setActiveModelId("");
      }
    }
  };

  const handleBulkDeleteSessions = () => {
    const ids = selectedSessionIds;
    if (ids.size === 0) return;
    const nextSessions = sessions.filter((session) => !ids.has(session.id));
    setSessions(nextSessions);
    if (activeSessionId && ids.has(activeSessionId)) {
      const fallback = nextSessions[0] || null;
      setActiveSessionId(fallback?.id || "");
      setActiveProviderId(fallback?.providerId || "");
      setActiveModelId(fallback?.modelId || "");
    }
    setSelectedSessionIds(new Set());
  };

  const toggleSessionSelected = (event: React.MouseEvent, sessionId: string) => {
    event.stopPropagation();
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const toggleAllVisibleSessions = () => {
    setSelectedSessionIds((prev) => {
      if (allVisibleSessionsSelected) return new Set();
      const next = new Set(prev);
      filteredSessionItems.forEach((session) => next.add(session.id));
      return next;
    });
  };

  const startRenameSession = (event: React.MouseEvent, session: ChatSession) => {
    event.stopPropagation();
    setRenamingSessionId(session.id);
    setRenameValue(session.title);
  };

  const commitRenameSession = (sessionId: string) => {
    const title = renameValue.trim();
    if (title) {
      setSessions((prev) => prev.map((session) => (session.id === sessionId ? { ...session, title } : session)));
    }
    setRenamingSessionId("");
  };

  const handleSelectModel = (modelId: string) => {
    const model = modelIndex.get(modelId);
    if (!model) return;

    const current = sessions.find((session) => session.id === activeSessionId);
    if (current && current.messages.length > 0) {
      const session = ensureSessionForModel(model);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    } else if (current) {
      setSessions((prev) => prev.map((item) => (item.id === current.id ? {
        ...item,
        providerId: model.providerId,
        providerName: model.providerName,
        modelId: model.id,
        modelName: model.name,
      } : item)));
      setActiveSessionId(current.id);
    } else {
      const session = ensureSessionForModel(model);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    }

    setActiveProviderId(model.providerId);
    setActiveModelId(model.id);
    setModelMenuOpen(false);
  };

  const handleAttachFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      event.target.value = "";
      return;
    }

    const converted = await Promise.all(images.map(async (file) => ({
      id: createId(),
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: await fileToDataUrl(file),
    })));

    setAttachments((prev) => [...prev, ...converted]);
    event.target.value = "";
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleCopyMessage = useCallback(async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(textValue(content));
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(""), 2000);
    } catch {
      // Ignore clipboard errors
    }
  }, []);

  const handleRetryMessage = useCallback((messageId: string) => {
    // Find the session and message, then resend from that point
    const session = sessions.find((s) => s.id === activeSessionId);
    if (!session || !activeModel) return;

    const msgIndex = session.messages.findIndex((m) => m.id === messageId);
    if (msgIndex < 0) return;

    // Remove the failed message and everything after it
    const trimmedMessages = session.messages.slice(0, msgIndex);
    const userMsg = trimmedMessages[trimmedMessages.length - 1];
    if (!userMsg || userMsg.role !== "user") return;

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId ? { ...s, messages: trimmedMessages } : s
      )
    );

    // Re-trigger send with the user message draft
    setDraft(textValue(userMsg.content));
    setTimeout(() => {
      sendMessage();
    }, 50);
  }, [sessions, activeSessionId, activeModel]);

  const handleFeedback = useCallback((messageId: string, feedback: "up" | "down") => {
    updateSession(activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((m) =>
        m.id === messageId ? { ...m, feedback: m.feedback === feedback ? null : feedback } : m
      ),
    }));
  }, [activeSessionId]);

  const handleExportConversation = useCallback((format: "json" | "markdown") => {
    const session = sessions.find((s) => s.id === activeSessionId);
    if (!session) return;

    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === "json") {
      content = JSON.stringify(session, null, 2);
      filename = `${session.title.replace(/[^a-z0-9]/gi, "_")}.json`;
      mimeType = "application/json";
    } else {
      content = `# ${session.title}\n\n`;
      content += `Model: ${session.modelName} (${session.providerName})\n`;
      content += `Created: ${new Date(session.createdAt).toLocaleString()}\n\n---\n\n`;
      for (const msg of session.messages) {
        const role = msg.role === "user" ? "**You**" : `**${session.modelName}**`;
        content += `${role}:\n${textValue(msg.content)}\n\n`;
      }
      filename = `${session.title.replace(/[^a-z0-9]/gi, "_")}.md`;
      mimeType = "text/markdown";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [sessions, activeSessionId]);

  // Command palette commands
  const commands = useMemo(() => [
    { id: "new-chat", label: translate("New conversation") || "New conversation", icon: <Plus className="size-4" />, action: handleNewChat },
    { id: "toggle-sidebar", label: translate("Toggle sidebar") || "Toggle sidebar", icon: <PanelLeft className="size-4" />, action: () => setSidebarOpen((v) => !v) },
    { id: "toggle-settings", label: translate("Toggle settings") || "Toggle settings", icon: <Settings2 className="size-4" />, action: () => setShowSettings((v) => !v) },
    { id: "select-model", label: translate("Select model") || "Select model", icon: <Zap className="size-4" />, action: () => setModelMenuOpen(true) },
    { id: "export-json", label: translate("Export as JSON") || "Export as JSON", icon: <Download className="size-4" />, action: () => handleExportConversation("json") },
    { id: "export-md", label: translate("Export as Markdown") || "Export as Markdown", icon: <Download className="size-4" />, action: () => handleExportConversation("markdown") },
    { id: "clear-chat", label: translate("Clear current chat") || "Clear current chat", icon: <Trash2 className="size-4" />, action: () => { if (activeSessionId) updateSession(activeSessionId, (s) => ({ ...s, messages: [] })); } },
  ], [handleNewChat, handleExportConversation, activeSessionId]);

  const filteredCommands = useMemo(() => {
    const q = commandSearch.toLowerCase().trim();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, commandSearch]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K: Command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
      // Escape: Close command palette
      if (e.key === "Escape" && commandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen]);

  const finalizeSessionTitle = (sessionId: string, titleSeed: string) => {
    const title = makeSessionTitle(titleSeed);
    updateSession(sessionId, (session) => ({
      ...session,
      title: session.title === (translate("New conversation") || "New conversation") ? title : session.title,
      updatedAt: new Date().toISOString(),
    }));
  };

  const sendMessage = async () => {
    const model = activeModel || activeProviderGroup?.models?.[0] || null;
    if (!model) return;

    const userText = draft.trim();
    if (!userText && attachments.length === 0) return;

    let sessionId = activeSessionId;
    let session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      const newSession = ensureSessionForModel(model);
      if (!newSession) return;
      session = newSession;
      sessionId = newSession.id;
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(sessionId);
    }

    const userMessage = {
      id: createId(),
      role: "user",
      content: userText,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        dataUrl: attachment.dataUrl,
      })),
      createdAt: new Date().toISOString(),
    };

    const assistantMessageId = createId();
    const assistantMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      status: "streaming",
    };

    const nextMessages = [...(session.messages || []), userMessage, assistantMessage];
    setSessions((prev) => prev.map((item) => (item.id === sessionId ? {
      ...item,
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.id,
      modelName: model.name,
      messages: nextMessages,
      updatedAt: new Date().toISOString(),
        title: item.title === (translate("New conversation") || "New conversation") ? makeSessionTitle(userText) : item.title,
    } : item)));
    setDraft("");
    setAttachments([]);
    setIsSending(true);
    setStreamingMessageId(assistantMessageId);
    setStreamingText("");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const requestMessages = nextMessages
      .filter((message) => !(message.role === "assistant" && message.id === assistantMessageId))
      .map((message) => ({
        role: message.role,
        content: message.role === "user" ? buildUserContent(message) : message.content,
      }));

    // Prepend system prompt if set
    if (systemPrompt.trim()) {
      requestMessages.unshift({ role: "system", content: systemPrompt.trim() });
    }

    try {
      const response = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: model.requestModel || model.id,
          messages: requestMessages,
          stream: true,
          temperature,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(textValue(errorData.error || errorData.message || `Request failed (${response.status})`));
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const data = await response.json().catch(() => ({})) as Record<string, unknown>;
        const fallbackText = textValue(((data?.choices as Array<Record<string, unknown>> | undefined)?.[0] as Record<string, unknown> | undefined)?.message || data?.output_text || data?.error || data?.message || "");
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: fallbackText, status: "done" } : message)),
          updatedAt: new Date().toISOString(),
        }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload);
            const text = readAssistantText(chunk);
            if (!text) continue;

            assistantText += text;
            setStreamingText(assistantText);
            updateSession(sessionId, (currentSession) => ({
              ...currentSession,
              messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: assistantText, status: "streaming" } : message)),
              updatedAt: new Date().toISOString(),
            }));
          } catch {
            // Ignore malformed chunks.
          }
        }
      }

      updateSession(sessionId, (currentSession) => ({
        ...currentSession,
        messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: assistantText || message.content, status: "done" } : message)),
        updatedAt: new Date().toISOString(),
      }));
      finalizeSessionTitle(sessionId, userText);
    } catch (error: unknown) {
      if ((error as Error).name !== "AbortError") {
        const errorText = textValue((error as Error)?.message || error);
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: message.content || `Error: ${errorText}`, status: "error" } : message)),
          updatedAt: new Date().toISOString(),
        }));
        setLoadError(errorText || "Failed to send message.");
      }
    } finally {
      setIsSending(false);
      setStreamingMessageId("");
      setStreamingText("");
      abortRef.current = null;
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) sendMessage();
    }
  };

  const modelLabel = activeModel ? activeModel.name : (translate("Select model") || "Select model");
  const modelSubLabel = activeModel ? activeModel.requestModel : (translate("Choose from connected providers") || "Choose from connected providers");

  return (
    <div className="relative flex-1 flex h-full min-h-0 min-w-0 bg-background text-foreground overflow-hidden">
      {/* ─── Sidebar ─────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <aside className="hidden lg:flex shrink-0 flex-col w-72 border-r border-border bg-card/50 min-h-0">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
            <h2 className="text-sm font-semibold text-foreground">{translate("Conversations") || "Conversations"}</h2>
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon-sm" type="button" aria-label={translate("Command palette") || "Command palette"} onClick={() => setCommandPaletteOpen(true)} className="size-7">
                <Command className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" type="button" aria-label={translate("Export") || "Export"} onClick={() => handleExportConversation("markdown")} className="size-7">
                <Download className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" type="button" aria-label={translate("New chat") || "New chat"} onClick={handleNewChat} disabled={!activeModel} className="size-7">
                <Plus className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" className="size-7">
                <PanelLeftClose className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="shrink-0 border-b border-border px-3 py-2">
            <div className="relative">
              <Search aria-hidden="true" className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder={translate("Search...") || "Search..."}
                className="h-7 pl-7 text-xs"
              />
            </div>
          </div>

          {selectedSessionCount > 0 && (
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
              <button type="button" onClick={toggleAllVisibleSessions} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <Checkbox checked={allVisibleSessionsSelected} className="pointer-events-none" />
                {`${selectedSessionCount} ${translate("selected") || "selected"}`}
              </button>
              <Button variant="ghost" size="icon-sm" type="button" onClick={handleBulkDeleteSessions} className="size-6 text-destructive hover:text-destructive">
                <Trash2 className="size-3" />
              </Button>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto p-2 custom-scrollbar">
            {groupedSessionItems.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                {historySearch ? (translate("No results") || "No results") : (translate("No conversations yet.") || "No conversations yet.")}
              </p>
            ) : (
              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={sessions.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  {groupedSessionItems.map((group) => (
                    <div key={group.label}>
                      <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                      {group.items.map((session) => (
                        <SortableSessionItem
                          key={session.id}
                          session={session}
                          isActive={session.id === activeSessionId}
                          isSelected={selectedSessionIds.has(session.id)}
                          isRenaming={renamingSessionId === session.id}
                          renameValue={renameValue}
                          selectedCount={selectedSessionCount}
                          onSelect={handleSelectSession}
                          onToggleSelect={toggleSessionSelected}
                          onStartRename={startRenameSession}
                          onCommitRename={(id) => { if (id) commitRenameSession(id); else setRenamingSessionId(""); }}
                          onDelete={handleDeleteSession}
                          onRenameChange={setRenameValue}
                          renameInputRef={renameInputRef}
                        />
                      ))}
                    </div>
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </div>
        </aside>
      )}

      {/* ─── Main Chat Area ──────────────────────────────────────────── */}
      <div className="relative flex-1 flex flex-col h-full min-h-0 min-w-0">
        {/* Top bar */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <Button variant="ghost" size="icon-sm" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar" className="size-7 hidden lg:flex">
                <PanelLeft className="size-3.5" />
              </Button>
            )}
            <button
              type="button"
              onClick={() => setModelMenuOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-foreground truncate max-w-[200px]">{modelLabel}</span>
                  <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                </div>
                <p className="truncate text-[11px] text-muted-foreground max-w-[240px]">{modelSubLabel}</p>
              </div>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="hidden sm:flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
            >
              <Command className="size-3" />
              <kbd className="font-mono">⌘K</kbd>
            </button>
            <Button variant="ghost" size="icon-sm" type="button" onClick={() => setShowSettings((v) => !v)} aria-label="Settings" className="size-7">
              <Settings2 className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" type="button" aria-label={translate("New chat") || "New chat"} onClick={handleNewChat} disabled={!activeModel} className="size-7 lg:hidden">
              <Plus className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" type="button" onClick={() => setHistoryOpen((v) => !v)} className="size-7 lg:hidden">
              <MessageSquare className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Settings panel (collapsible) */}
        {showSettings && (
          <div className="shrink-0 border-b border-border bg-card/50 px-4 py-3">
            <div className="mx-auto max-w-3xl space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  {translate("System prompt") || "System prompt"}
                </label>
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={translate("You are a helpful assistant...") || "You are a helpful assistant..."}
                  rows={2}
                  className="text-xs resize-none"
                />
              </div>
              <div className="flex items-center gap-4">
                <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                  {translate("Temperature") || "Temperature"}: {temperature.toFixed(1)}
                </label>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="flex-1 h-1.5 accent-primary"
                />
                <span className="text-[10px] text-muted-foreground w-8 text-right">{temperature.toFixed(1)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Mobile history dropdown */}
        {historyOpen && (
          <div ref={historyMenuRef} className="absolute right-4 top-[52px] z-20 flex max-h-[70vh] w-[min(340px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl lg:hidden">
            <div className="shrink-0 border-b border-border px-3 py-2">
              <div className="relative">
                <Search aria-hidden="true" className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                <Input value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} placeholder={translate("Search...") || "Search..."} className="h-7 pl-7 text-xs" />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
              {groupedSessionItems.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">{translate("No conversations yet.") || "No conversations yet."}</p>
              ) : groupedSessionItems.map((group) => (
                <div key={group.label}>
                  <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                  {group.items.map((session) => (
                    <button key={session.id} type="button" onClick={() => handleSelectSession(session.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted ${session.id === activeSessionId ? "bg-muted" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{session.title}</p>
                        <p className="text-[10px] text-muted-foreground">{formatRelativeTime(session.updatedAt)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Model picker modal */}
        <ModelPickerModal
          open={modelMenuOpen}
          onOpenChange={setModelMenuOpen}
          providerGroups={providerGroups}
          activeModelId={activeModelId}
          onSelect={handleSelectModel}
          loading={loadingData}
          error={loadError}
        />

        {/* Command palette (Cmd+K) */}
        {commandPaletteOpen && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={() => setCommandPaletteOpen(false)}>
            <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <Command className="size-4 text-muted-foreground" />
                <input
                  autoFocus
                  value={commandSearch}
                  onChange={(e) => setCommandSearch(e.target.value)}
                  placeholder={translate("Type a command...") || "Type a command..."}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setCommandPaletteOpen(false);
                    if (e.key === "Enter" && filteredCommands.length > 0) {
                      filteredCommands[0].action();
                      setCommandPaletteOpen(false);
                    }
                  }}
                />
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
              </div>
              <div className="max-h-64 overflow-y-auto p-1">
                {filteredCommands.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">{translate("No commands found") || "No commands found"}</p>
                ) : filteredCommands.map((cmd) => (
                  <button
                    key={cmd.id}
                    type="button"
                    onClick={() => { cmd.action(); setCommandPaletteOpen(false); setCommandSearch(""); }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span className="text-muted-foreground">{cmd.icon}</span>
                    <span className="text-foreground">{cmd.label}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-border px-4 py-2">
                <span className="text-[10px] text-muted-foreground">{translate("Command palette") || "Command palette"}</span>
                <div className="flex items-center gap-1">
                  <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">⌘K</kbd>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error banner */}
        {loadError && !modelMenuOpen ? (
          <div className="mx-4 mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
            <div className="flex items-start gap-2">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p className="text-xs leading-5">{loadError}</p>
            </div>
          </div>
        ) : null}

        {/* Messages area */}
        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
            {currentMessages.length === 0 ? (
              <div className="flex min-h-[50vh] items-center justify-center px-4 text-center">
                <div className="max-w-lg space-y-4">
                  <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/40 text-primary">
                    <MessageSquare className="size-7" />
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="text-xl font-semibold text-foreground">{translate("Start a conversation") || "Start a conversation"}</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {translate("Select a model and start chatting with any AI from your connected providers.") || "Select a model and start chatting with any AI from your connected providers."}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4">
              {currentMessages.map((message) => {
                const isUser = message.role === "user";
                const isAssistant = message.role === "assistant";
                const isStreaming = isAssistant && message.id === streamingMessageId && message.status === "streaming";
                const isError = message.status === "error";
                const content = textValue(message.content) || (isAssistant ? streamingText : "");

                return (
                  <div key={message.id} className={`group/msg flex w-full chat-message-enter ${isUser ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[min(88%,44rem)] ${isUser ? "rounded-2xl bg-primary text-primary-foreground px-4 py-3" : "text-foreground"}`}>
                      {/* Message header */}
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className={`text-xs font-semibold ${isUser ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {isUser ? (translate("You") || "You") : activeModel?.name || (translate("Assistant") || "Assistant")}
                        </span>
                        {isError && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Error</Badge>
                        )}
                      </div>

                      {/* Attachments */}
                      {message.attachments?.length ? (
                        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {message.attachments.map((attachment) => (
                            <a key={attachment.id} href={attachment.dataUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-border bg-muted/40">
                              <img src={attachment.dataUrl} alt={attachment.name} className="h-24 w-full object-cover" loading="lazy" decoding="async" />
                            </a>
                          ))}
                        </div>
                      ) : null}

                      {/* Message content */}
                      {isAssistant ? (
                        <div
                          className="prose-chat break-words text-[15px] leading-7"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
                        />
                      ) : (
                        <div className="whitespace-pre-wrap break-words text-[15px] leading-7">
                          {content}
                        </div>
                      )}

                      {/* Streaming cursor */}
                      {isAssistant && isStreaming && !streamingText && (
                        <span className="inline-block animate-pulse text-primary">▋</span>
                      )}

                      {/* Tool calls */}
                      {message.toolCalls && message.toolCalls.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {message.toolCalls.map((tc) => (
                            <div key={tc.id} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                              <div className="flex items-center gap-2">
                                <Wrench className="size-3 text-muted-foreground" />
                                <span className="text-xs font-medium text-foreground">{tc.name}</span>
                                <Badge variant={tc.status === "done" ? "default" : tc.status === "error" ? "destructive" : "secondary"} className="text-[9px] px-1 py-0">
                                  {tc.status || "pending"}
                                </Badge>
                              </div>
                              {tc.result && (
                                <pre className="mt-1 text-[11px] text-muted-foreground overflow-x-auto max-h-32 overflow-y-auto">
                                  {tc.result.slice(0, 500)}{tc.result.length > 500 ? "..." : ""}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Message actions */}
                      {isAssistant && !isStreaming && content && (
                        <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100">
                          <button
                            type="button"
                            onClick={() => handleCopyMessage(message.id, content)}
                            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            {copiedMessageId === message.id ? (
                              <><Check className="size-3" /> Copied</>
                            ) : (
                              <><Copy className="size-3" /> Copy</>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleFeedback(message.id, "up")}
                            className={`flex items-center rounded-md px-1.5 py-1 transition-colors ${message.feedback === "up" ? "text-green-500 bg-green-500/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                          >
                            <ThumbsUp className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleFeedback(message.id, "down")}
                            className={`flex items-center rounded-md px-1.5 py-1 transition-colors ${message.feedback === "down" ? "text-red-500 bg-red-500/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                          >
                            <ThumbsDown className="size-3" />
                          </button>
                          {isError && (
                            <button
                              type="button"
                              onClick={() => handleRetryMessage(message.id)}
                              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            >
                              <RefreshCw className="size-3" /> Retry
                            </button>
                          )}
                          {/* Token usage */}
                          {message.tokenUsage && (
                            <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/60">
                              <Hash className="size-2.5" />
                              {message.tokenUsage.total_tokens || (message.tokenUsage.prompt_tokens || 0) + (message.tokenUsage.completion_tokens || 0)} tokens
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Input area */}
          <div className="shrink-0 pt-2">
            {attachments.length > 0 && (
              <div className="mx-auto mb-3 flex w-full max-w-3xl flex-wrap gap-2 px-4">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5">
                    <span className="text-xs text-card-foreground max-w-[10rem] truncate">{attachment.name}</span>
                    <button type="button" onClick={() => removeAttachment(attachment.id)} className="text-muted-foreground hover:text-foreground" aria-label="Remove">
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mx-auto w-full max-w-3xl px-4 pb-3">
              <div className="rounded-2xl border border-border bg-card px-3 pt-3 pb-2 shadow-sm">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={translate("Message to AI") || "Message to AI"}
                  rows={1}
                  className="resize-none border-0 bg-transparent px-2 text-[15px] leading-6 text-foreground placeholder:text-muted-foreground custom-scrollbar max-h-[25vh] focus-visible:ring-0 focus-visible:ring-offset-0"
                />

                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="icon-sm" type="button" aria-label={translate("Attach image") || "Attach image"} onClick={() => fileInputRef.current?.click()} disabled={!activeModel || loadingData} className="size-7 text-muted-foreground hover:text-foreground">
                      <Paperclip className="size-4" />
                    </Button>
                    <Input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAttachFiles} />
                    <span className="text-[11px] font-medium text-muted-foreground truncate max-w-[140px]">
                      {activeModel ? activeModel.name : (translate("No model") || "No model")}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {isSending && (
                      <button
                        type="button"
                        aria-label={translate("Stop generation") || "Stop generation"}
                        onClick={handleStop}
                        className="flex items-center gap-1.5 rounded-full bg-destructive text-destructive-foreground px-3 py-1.5 text-xs font-medium animate-pulse-stop hover:bg-destructive/90 transition-colors"
                      >
                        <StopCircle className="size-3.5" />
                        {translate("Stop") || "Stop"}
                      </button>
                    )}
                    <Button variant="default" size="icon-sm" aria-label={translate("Send") || "Send"} onClick={sendMessage} disabled={!canSend} className="size-7">
                      <ArrowUp className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
