import { translate } from "@/i18n/runtime";
import type { ChatMessage, ChatSession } from "./types";

// One parser, two readers: the browser here and the durable-run worker on the
// server both read the same OpenAI-compatible chunks. Re-exported rather than
// re-implemented so a provider quirk fixed in one is fixed in both.
export { textValue, readStreamUsage } from "@/shared/chat/streamChunk";
import { textValue } from "@/shared/chat/streamChunk";

export function createId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function safeParse(value: string | null, fallback: unknown): unknown {
  try {
    return JSON.parse(value ?? "");
  } catch {
    return fallback;
  }
}

export function humanize(value = ""): string {
  return String(value)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || "Unknown";
}

export function formatRelativeTime(value: string | undefined | null): string {
  if (!value) return "Now";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Now";
  const diffMinutes = Math.max(1, Math.round((Date.now() - time) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.round(diffHours / 24)}d`;
}


export function getDateGroup(value: string): string {
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

export function makeSessionTitle(text = ""): string {
  const normalized = textValue(text).replace(/\s+/g, " ").trim();
  if (!normalized) return translate("New conversation") || "New conversation";
  return normalized.length > 52 ? `${normalized.slice(0, 52).trimEnd()}…` : normalized;
}

export function buildUserContent(message: ChatMessage): unknown {
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

export async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function cloneSession(session: ChatSession): ChatSession {
  return {
    ...session,
    messages: Array.isArray(session.messages) ? session.messages.map((message) => ({ ...message })) : [],
  };
}
