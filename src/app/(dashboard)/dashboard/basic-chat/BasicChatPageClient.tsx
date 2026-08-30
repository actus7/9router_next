"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/shared/components";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getModelsByProviderId } from "@/shared/constants/models";
import { isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { AlertCircle, ArrowUp, CheckCircle2, ChevronDown, MessageSquare, Paperclip, Pencil, Plus, Search, Square, Trash2, X } from "lucide-react";
import { translate } from "@/i18n/runtime";

const STORAGE_KEYS = {
  sessions: "basic-chat.sessions",
  activeSessionId: "basic-chat.activeSessionId",
  activeProviderId: "basic-chat.activeProviderId",
  draft: "basic-chat.draft",
};

interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size?: number;
  dataUrl: string;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string | unknown;
  attachments?: ChatAttachment[];
  createdAt?: string;
  status?: string;
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
  const [modelSearch, setModelSearch] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
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

  const filteredProviderGroups = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return providerGroups;
    return providerGroups
      .map((group) => ({
        ...group,
        models: group.models.filter((model) => model.name.toLowerCase().includes(q) || model.requestModel.toLowerCase().includes(q) || group.providerName.toLowerCase().includes(q)),
      }))
      .filter((group) => group.models.length > 0);
  }, [providerGroups, modelSearch]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      globalThis.localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
      globalThis.localStorage.setItem(STORAGE_KEYS.activeSessionId, activeSessionId);
      globalThis.localStorage.setItem(STORAGE_KEYS.activeProviderId, activeProviderId);
      globalThis.localStorage.setItem(STORAGE_KEYS.draft, draft);
    } catch {
      // Ignore storage errors.
    }
  }, [isHydrated, sessions, activeSessionId, activeProviderId, draft]);

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

  const modelLabel = activeModel ? `${activeModel.name}` : (translate("Select model") || "Select model");
  const modelSubLabel = activeModel ? activeModel.requestModel : (translate("Choose from connected providers") || "Choose from connected providers");

  return (
    <div className="relative flex-1 flex flex-col h-full min-h-0 min-w-0 bg-background text-foreground overflow-hidden">
      <div className="relative mx-auto flex flex-1 h-full min-h-0 w-full max-w-4xl flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 lg:px-6">
          <Button
            variant="outline"
            type="button"
            onClick={() => setModelMenuOpen(true)}
            className="gap-3 rounded-2xl px-4 py-3 h-auto text-left"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{modelLabel}</span>
                <ChevronDown className="size-4 text-muted-foreground" />
              </div>
              <p className="truncate text-xs text-muted-foreground">{modelSubLabel}</p>
            </div>
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" type="button" aria-label={translate("New chat") || "New chat"} onClick={handleNewChat} disabled={!activeModel} className="rounded-full">
              <Plus className="size-4" />
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={() => setHistoryOpen((value) => !value)}
              className="rounded-2xl px-4 py-3 h-auto text-sm"
            >
              {translate("History") || "History"}
            </Button>
          </div>
        </div>

        <Dialog open={modelMenuOpen} onOpenChange={(open) => { setModelMenuOpen(open); if (!open) setModelSearch(""); }}>
          <DialogContent className="max-w-2xl gap-0 p-0 overflow-hidden">
            <DialogHeader className="border-b border-border px-4 py-4">
              <DialogTitle>{translate("Select a model") || "Select a model"}</DialogTitle>
            </DialogHeader>
            <div className="border-b border-border px-4 py-3">
              <div className="relative">
                <Search aria-hidden="true" className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                  placeholder={translate("Search models or providers...") || "Search models or providers..."}
                  className="h-9 pl-8"
                />
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2 custom-scrollbar">
              {filteredProviderGroups.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">{translate("No models found.") || "No models found."}</p>
              ) : filteredProviderGroups.map((group) => (
                <div key={group.providerId} className="mb-2">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{group.providerName}</p>
                    <Badge variant="secondary">{group.models.length}</Badge>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {group.models.map((model) => {
                      const isActive = model.id === activeModelId;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => { handleSelectModel(model.id); setModelSearch(""); }}
                          className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${isActive ? "bg-primary/10" : "hover:bg-muted"}`}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-card-foreground">{model.name}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{model.requestModel}</p>
                          </div>
                          {isActive ? <CheckCircle2 className="size-4 shrink-0 text-primary" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {historyOpen ? (
          <div ref={historyMenuRef} className="absolute right-4 top-[72px] z-20 flex max-h-[70vh] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl lg:right-6">
            <div className="shrink-0 border-b border-border px-3 py-2">
              <div className="relative">
                <Search aria-hidden="true" className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder={translate("Search conversations...") || "Search conversations..."}
                  className="h-8 pl-7 text-xs"
                />
              </div>
            </div>

            {selectedSessionCount > 0 ? (
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
                <button
                  type="button"
                  onClick={toggleAllVisibleSessions}
                  className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Checkbox checked={allVisibleSessionsSelected} className="pointer-events-none" />
                  {`${selectedSessionCount} ${translate("selected") || "selected"}`}
                </button>
                <Button variant="ghost" size="icon-sm" type="button" onClick={handleBulkDeleteSessions} aria-label={translate("Delete selected") || "Delete selected"} className="text-destructive hover:text-destructive">
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2 custom-scrollbar">
              {groupedSessionItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                  {historySearch ? (translate("No results") || "No results") : (translate("No conversations yet.") || "No conversations yet.")}
                </div>
              ) : groupedSessionItems.map((group) => (
                <div key={group.label}>
                  <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                  {group.items.map((session) => {
                    const isActive = session.id === activeSessionId;
                    const isSelected = selectedSessionIds.has(session.id);
                    const isRenaming = renamingSessionId === session.id;
                    return (
                      <div
                        key={session.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => { if (!isRenaming) handleSelectSession(session.id); }}
                        onKeyDown={(event) => { if (!isRenaming && event.key === "Enter") handleSelectSession(session.id); }}
                        className={`group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted ${isActive ? "bg-muted font-medium" : ""} ${isSelected ? "bg-muted/80" : ""}`}
                      >
                        <button
                          type="button"
                          aria-label={isSelected ? (translate("Deselect") || "Deselect") : (translate("Select") || "Select")}
                          onClick={(event) => toggleSessionSelected(event, session.id)}
                          className={`shrink-0 items-center justify-center rounded border transition-all ${
                            isSelected || selectedSessionCount > 0
                              ? "flex size-4 border-border bg-background"
                              : "hidden group-hover:flex group-hover:size-4 group-hover:border-border group-hover:bg-background"
                          } ${isSelected ? "border-primary bg-primary text-primary-foreground" : ""}`}
                        >
                          {isSelected ? <CheckCircle2 className="size-3" /> : null}
                        </button>
                        <div className="min-w-0 flex-1">
                          {isRenaming ? (
                            <input
                              ref={renameInputRef}
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Enter") commitRenameSession(session.id);
                                if (event.key === "Escape") setRenamingSessionId("");
                              }}
                              onBlur={() => commitRenameSession(session.id)}
                              className="h-6 w-full rounded border border-border bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          ) : (
                            <>
                              <p className="truncate text-xs font-medium text-card-foreground">{session.title}</p>
                              <p className="text-[10px] text-muted-foreground">{formatRelativeTime(session.updatedAt)}</p>
                            </>
                          )}
                        </div>
                        {!isRenaming ? (
                          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            <Button variant="ghost" size="icon-sm" type="button" onClick={(event: React.MouseEvent) => startRenameSession(event, session)} aria-label={translate("Rename") || "Rename"} className="size-6">
                              <Pencil className="size-3" />
                            </Button>
                            <Button variant="ghost" size="icon-sm" type="button" onClick={(event: React.MouseEvent) => { event.stopPropagation(); handleDeleteSession(session.id); }} aria-label={translate("Delete") || "Delete"} className="size-6 text-destructive hover:text-destructive">
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {loadError ? (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5" />
              <p className="text-sm leading-6">{loadError}</p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
            {currentMessages.length === 0 ? (
              <div className="flex min-h-[50vh] items-center justify-center px-4 text-center">
                <div className="max-w-xl space-y-4">
                  <div className="mx-auto flex size-16 items-center justify-center rounded-2xl border border-border bg-muted/40 text-primary">
                    <MessageSquare className="size-8" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold text-foreground">{translate("Start a conversation") || "Start a conversation"}</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {translate("Simple chat interface to interact with any AI model from connected providers. Select a model and start chatting!") || "Simple chat interface to interact with any AI model from connected providers. Select a model and start chatting!"}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
              {currentMessages.map((message) => {
                const isUser = message.role === "user";
                const isAssistant = message.role === "assistant";
                const isStreaming = isAssistant && message.id === streamingMessageId && message.status === "streaming";
                const content = textValue(message.content) || (isAssistant ? streamingText : "");

                return (
                  <div key={message.id} className={`flex w-full ${isUser ? "justify-end" : "justify-start"} mb-6`}>
                    <div className={`max-w-[min(88%,42rem)] ${isUser ? "rounded-3xl bg-primary text-primary-foreground px-5 py-3.5" : "text-foreground"}`}>
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className={`text-xs font-semibold ${isUser ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{isUser ? (translate("You") || "You") : activeModel?.name || (translate("Assistant") || "Assistant")}</span>
                      </div>

                      {message.attachments?.length ? (
                        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 mt-2">
                          {message.attachments.map((attachment) => (
                            <a key={attachment.id} href={attachment.dataUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-border bg-muted/40">
                              <img src={attachment.dataUrl} alt={attachment.name} className="h-28 w-full object-cover" loading="lazy" decoding="async" />
                            </a>
                          ))}
                        </div>
                      ) : null}

                      <div className="whitespace-pre-wrap break-words text-[15px] leading-7">
                        {content}
                        {isAssistant && isStreaming && !streamingText ? <span className="inline-block animate-pulse text-primary">▋</span> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="shrink-0 pt-2">
            {attachments.length > 0 ? (
              <div className="mx-auto mb-3 flex w-full max-w-3xl flex-wrap gap-2 px-4">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-2">
                    <span className="text-xs text-card-foreground max-w-[12rem] truncate">{attachment.name}</span>
                    <Button variant="ghost" size="icon-sm" type="button" onClick={() => removeAttachment(attachment.id)} className="text-muted-foreground hover:text-foreground" aria-label="Remove attachment">
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mx-auto w-full max-w-3xl px-4 pb-2">
              <div className="rounded-[26px] border border-border bg-card px-3 pt-3 pb-2 shadow-sm">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={translate("Message to AI") || "Message to AI"}
                  rows={1}
                  className="resize-none border-0 bg-transparent px-2 text-[15px] leading-6 text-foreground placeholder:text-muted-foreground custom-scrollbar max-h-[25vh] focus-visible:ring-0 focus-visible:ring-offset-0"
                />

                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" type="button" aria-label={translate("Attach image") || "Attach image"} onClick={() => fileInputRef.current?.click()} disabled={!activeModel || loadingData} className="rounded-full text-muted-foreground hover:text-foreground">
                      <Paperclip className="size-5" />
                    </Button>
                    <Input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAttachFiles} />
                    <span className="text-xs font-medium text-muted-foreground truncate max-w-[120px]">{activeModel ? activeModel.name : (translate("No model") || "No model")}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isSending ? (
                      <Button variant="secondary" size="icon" type="button" aria-label={translate("Stop generation") || "Stop generation"} onClick={handleStop} className="rounded-full">
                        <Square className="size-4" />
                      </Button>
                    ) : null}
                    <Button variant="default" size="icon" aria-label={translate("Send message") || "Send message"} onClick={sendMessage} disabled={!canSend} className="rounded-full">
                      <ArrowUp className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p className="mx-auto mt-2 max-w-3xl px-4 pb-4 text-center text-[11px] text-muted-foreground">
            {translate("Model list is filtered from connected providers.") || "Model list is filtered from connected providers."}
          </p>
        </div>
      </div>
    </div>
  );
}
