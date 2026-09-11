import { safeParse } from "../chatFormatUtils";
import type { ChatAttachment, ChatProject, ChatSession } from "../types";

export const STORAGE_KEYS = {
  sessions: "basic-chat.sessions",
  activeSessionId: "basic-chat.activeSessionId",
  activeProviderId: "basic-chat.activeProviderId",
  activeModelId: "basic-chat.activeModelId",
  /** Pre-split single draft. Read once on hydrate, never written again. */
  draft: "basic-chat.draft",
  drafts: "basic-chat.drafts",
  /** Pre-split page-wide inference settings. Read once on hydrate, then dropped. */
  systemPrompt: "basic-chat.systemPrompt",
  temperature: "basic-chat.temperature",
  reasoningEffort: "basic-chat.reasoningEffort",
  projects: "basic-chat.projects",
  activeProjectId: "basic-chat.activeProjectId",
  sidebarOpen: "basic-chat.sidebarOpen",
  conversationDisplay: "basic-chat.executionDisplay",
  enterBehavior: "basic-chat.enterBehavior",
};

export const DATE_GROUP_ORDER = [
  "Hoje",
  "Ontem",
  "Últimos 7 dias",
  "Últimos 30 dias",
  "Anteriores",
];

export interface HydratedState {
  sessions: ChatSession[];
  projects: ChatProject[];
  activeProjectId: string;
  activeSessionId: string;
  activeProviderId: string;
  activeModelId: string;
  /** The single draft this browser had before drafts became per-conversation. */
  draft: string;
  drafts: Record<string, { text: string; attachments: ChatAttachment[] }>;
  sidebarOpen: boolean;
  systemPrompt: string;
  temperature: number;
  reasoningEffort: "low" | "medium" | "high" | null;
  conversationDisplay: "normal" | "compact";
  enterBehavior: "queue" | "steer";
}

export function hydrateFromStorage(): HydratedState {
  const savedSessions = safeParse(
    globalThis.localStorage.getItem(STORAGE_KEYS.sessions),
    [],
  );
  const sessions = Array.isArray(savedSessions)
    ? (savedSessions.map((session) => ({
        ...session,
        messages: Array.isArray(session?.messages) ? session.messages : [],
      })) as ChatSession[])
    : [];

  const savedProjects = safeParse(
    globalThis.localStorage.getItem(STORAGE_KEYS.projects),
    [],
  );
  const projects = Array.isArray(savedProjects)
    ? savedProjects.filter((project): project is ChatProject =>
        Boolean(
          project &&
          typeof project.id === "string" &&
          typeof project.title === "string",
        ),
      )
    : [];

  const savedTemperature = Number(
    globalThis.localStorage.getItem(STORAGE_KEYS.temperature),
  );
  const temperature =
    Number.isFinite(savedTemperature) &&
    savedTemperature >= 0 &&
    savedTemperature <= 2
      ? savedTemperature
      : 0.7;

  const savedReasoningEffort = globalThis.localStorage.getItem(
    STORAGE_KEYS.reasoningEffort,
  );
  const reasoningEffort: "low" | "medium" | "high" | null =
    savedReasoningEffort === "low" ||
    savedReasoningEffort === "medium" ||
    savedReasoningEffort === "high"
      ? savedReasoningEffort
      : null;

  return {
    sessions,
    projects,
    activeProjectId:
      globalThis.localStorage.getItem(STORAGE_KEYS.activeProjectId) || "",
    activeSessionId:
      globalThis.localStorage.getItem(STORAGE_KEYS.activeSessionId) || "",
    activeProviderId:
      globalThis.localStorage.getItem(STORAGE_KEYS.activeProviderId) || "",
    activeModelId:
      globalThis.localStorage.getItem(STORAGE_KEYS.activeModelId) || "",
    draft: globalThis.localStorage.getItem(STORAGE_KEYS.draft) || "",
    drafts: safeParse(globalThis.localStorage.getItem(STORAGE_KEYS.drafts), {}) as HydratedState["drafts"],
    sidebarOpen:
      globalThis.localStorage.getItem(STORAGE_KEYS.sidebarOpen) !== "false",
    systemPrompt:
      globalThis.localStorage.getItem(STORAGE_KEYS.systemPrompt) || "",
    temperature,
    reasoningEffort,
    conversationDisplay:
      globalThis.localStorage.getItem(STORAGE_KEYS.conversationDisplay) ===
      "normal"
        ? "normal"
        : "compact",
    enterBehavior:
      globalThis.localStorage.getItem(STORAGE_KEYS.enterBehavior) === "steer"
        ? "steer"
        : "queue",
  };
}

export function persistToStorage(params: {
  sessions: ChatSession[];
  activeSessionId: string;
  activeProviderId: string;
  activeModelId: string;
  drafts: Record<string, { text: string; attachments: ChatAttachment[] }>;
  projects: ChatProject[];
  activeProjectId: string;
  sidebarOpen: boolean;
  conversationDisplay: "normal" | "compact";
  enterBehavior: "queue" | "steer";
}): void {
  globalThis.localStorage.setItem(
    STORAGE_KEYS.sessions,
    JSON.stringify(params.sessions),
  );
  globalThis.localStorage.setItem(
    STORAGE_KEYS.activeSessionId,
    params.activeSessionId,
  );
  globalThis.localStorage.setItem(
    STORAGE_KEYS.activeProviderId,
    params.activeProviderId,
  );
  globalThis.localStorage.setItem(
    STORAGE_KEYS.activeModelId,
    params.activeModelId,
  );
  globalThis.localStorage.setItem(STORAGE_KEYS.drafts, JSON.stringify(params.drafts));
  // The pre-split key is migrated on hydrate and must not come back, or the
  // next hydrate would re-seed a draft the user already sent.
  globalThis.localStorage.removeItem(STORAGE_KEYS.draft);
  // The pre-split inference keys are migrated on hydrate onto the conversation
  // that owned them, and must not come back: they now live in `sessions`.
  globalThis.localStorage.removeItem(STORAGE_KEYS.systemPrompt);
  globalThis.localStorage.removeItem(STORAGE_KEYS.temperature);
  globalThis.localStorage.removeItem(STORAGE_KEYS.reasoningEffort);
  globalThis.localStorage.setItem(
    STORAGE_KEYS.projects,
    JSON.stringify(params.projects),
  );
  globalThis.localStorage.setItem(
    STORAGE_KEYS.activeProjectId,
    params.activeProjectId,
  );
  globalThis.localStorage.setItem(
    STORAGE_KEYS.sidebarOpen,
    String(params.sidebarOpen),
  );
  globalThis.localStorage.setItem(
    STORAGE_KEYS.conversationDisplay,
    params.conversationDisplay,
  );
  globalThis.localStorage.setItem(
    STORAGE_KEYS.enterBehavior,
    params.enterBehavior,
  );
}
