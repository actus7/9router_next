import { safeParse } from "../chatFormatUtils";
import type { ChatAttachment, ChatProject, ChatSession } from "../types";

const STORAGE_KEYS = {
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

/**
 * Keys that hold one person's data in one workspace: conversations, projects,
 * drafts, what was open. They are stored per scope (`<tenant>:<user>`), never
 * globally — a global copy was shown to whoever signed in next on the same
 * browser, and the sync then uploaded it as theirs. Display preferences
 * (sidebar, density, Enter behaviour) stay browser-wide on purpose.
 */
const SCOPED_KEYS = [
  STORAGE_KEYS.sessions,
  STORAGE_KEYS.activeSessionId,
  STORAGE_KEYS.activeProviderId,
  STORAGE_KEYS.activeModelId,
  STORAGE_KEYS.drafts,
  STORAGE_KEYS.projects,
  STORAGE_KEYS.activeProjectId,
] as const;

/**
 * Pre-scope copies. Nothing says whose they were, so they are never imported
 * into a scope — only removed. The server keeps every synced conversation and
 * hands it back to its real owner.
 */
const LEGACY_GLOBAL_KEYS = [
  ...SCOPED_KEYS,
  STORAGE_KEYS.draft,
  STORAGE_KEYS.systemPrompt,
  STORAGE_KEYS.temperature,
  STORAGE_KEYS.reasoningEffort,
];

const scoped = (key: string, scope: string): string => `${key}@${scope}`;

function dropLegacyGlobalCopies(): void {
  for (const key of LEGACY_GLOBAL_KEYS) globalThis.localStorage.removeItem(key);
}

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

export function hydrateFromStorage(scope: string): HydratedState {
  dropLegacyGlobalCopies();
  const read = (key: string): string | null => globalThis.localStorage.getItem(scoped(key, scope));
  const savedSessions = safeParse(read(STORAGE_KEYS.sessions), []);
  const sessions = Array.isArray(savedSessions)
    ? (savedSessions.map((session) => ({
        ...session,
        messages: Array.isArray(session?.messages) ? session.messages : [],
      })) as ChatSession[])
    : [];

  const savedProjects = safeParse(read(STORAGE_KEYS.projects), []);
  const projects = Array.isArray(savedProjects)
    ? savedProjects.filter((project): project is ChatProject =>
        Boolean(
          project &&
          typeof project.id === "string" &&
          typeof project.title === "string",
        ),
      )
    : [];

  return {
    sessions,
    projects,
    activeProjectId: read(STORAGE_KEYS.activeProjectId) || "",
    activeSessionId: read(STORAGE_KEYS.activeSessionId) || "",
    activeProviderId: read(STORAGE_KEYS.activeProviderId) || "",
    activeModelId: read(STORAGE_KEYS.activeModelId) || "",
    // The pre-split single draft and page-wide inference settings were global
    // keys; whose they were is unknown, so they are not carried into a scope.
    draft: "",
    drafts: safeParse(read(STORAGE_KEYS.drafts), {}) as HydratedState["drafts"],
    sidebarOpen:
      globalThis.localStorage.getItem(STORAGE_KEYS.sidebarOpen) !== "false",
    systemPrompt: "",
    temperature: 0.7,
    reasoningEffort: null,
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
}, scope: string): void {
  const write = (key: string, value: string) => globalThis.localStorage.setItem(scoped(key, scope), value);
  write(STORAGE_KEYS.sessions, JSON.stringify(params.sessions));
  write(STORAGE_KEYS.activeSessionId, params.activeSessionId);
  write(STORAGE_KEYS.activeProviderId, params.activeProviderId);
  write(STORAGE_KEYS.activeModelId, params.activeModelId);
  write(STORAGE_KEYS.drafts, JSON.stringify(params.drafts));
  write(STORAGE_KEYS.projects, JSON.stringify(params.projects));
  write(STORAGE_KEYS.activeProjectId, params.activeProjectId);
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
