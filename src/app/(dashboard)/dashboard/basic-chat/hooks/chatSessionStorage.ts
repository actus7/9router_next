import { safeParse } from "../chatFormatUtils";
import type { ChatProject, ChatSession } from "../types";

export const STORAGE_KEYS = {
  sessions: "basic-chat.sessions",
  activeSessionId: "basic-chat.activeSessionId",
  activeProviderId: "basic-chat.activeProviderId",
  activeModelId: "basic-chat.activeModelId",
  draft: "basic-chat.draft",
  systemPrompt: "basic-chat.systemPrompt",
  temperature: "basic-chat.temperature",
  projects: "basic-chat.projects",
  activeProjectId: "basic-chat.activeProjectId",
  sidebarOpen: "basic-chat.sidebarOpen",
};

export const DATE_GROUP_ORDER = ["Hoje", "Ontem", "Últimos 7 dias", "Últimos 30 dias", "Anteriores"];

export interface HydratedState {
  sessions: ChatSession[];
  projects: ChatProject[];
  activeProjectId: string;
  activeSessionId: string;
  activeProviderId: string;
  activeModelId: string;
  draft: string;
  sidebarOpen: boolean;
  systemPrompt: string;
  temperature: number;
}

export function hydrateFromStorage(): HydratedState {
  const savedSessions = safeParse(globalThis.localStorage.getItem(STORAGE_KEYS.sessions), []);
  const sessions = Array.isArray(savedSessions)
    ? (savedSessions.map((session) => ({
        ...session,
        messages: Array.isArray(session?.messages) ? session.messages : [],
      })) as ChatSession[])
    : [];

  const savedProjects = safeParse(globalThis.localStorage.getItem(STORAGE_KEYS.projects), []);
  const projects = Array.isArray(savedProjects)
    ? savedProjects.filter((project): project is ChatProject =>
        Boolean(project && typeof project.id === "string" && typeof project.title === "string"),
      )
    : [];

  const savedTemperature = Number(globalThis.localStorage.getItem(STORAGE_KEYS.temperature));
  const temperature =
    Number.isFinite(savedTemperature) && savedTemperature >= 0 && savedTemperature <= 2
      ? savedTemperature
      : 0.7;

  return {
    sessions,
    projects,
    activeProjectId: globalThis.localStorage.getItem(STORAGE_KEYS.activeProjectId) || "",
    activeSessionId: globalThis.localStorage.getItem(STORAGE_KEYS.activeSessionId) || "",
    activeProviderId: globalThis.localStorage.getItem(STORAGE_KEYS.activeProviderId) || "",
    activeModelId: globalThis.localStorage.getItem(STORAGE_KEYS.activeModelId) || "",
    draft: globalThis.localStorage.getItem(STORAGE_KEYS.draft) || "",
    sidebarOpen: globalThis.localStorage.getItem(STORAGE_KEYS.sidebarOpen) !== "false",
    systemPrompt: globalThis.localStorage.getItem(STORAGE_KEYS.systemPrompt) || "",
    temperature,
  };
}

export function persistToStorage(params: {
  sessions: ChatSession[];
  activeSessionId: string;
  activeProviderId: string;
  activeModelId: string;
  draft: string;
  systemPrompt: string;
  temperature: number;
  projects: ChatProject[];
  activeProjectId: string;
  sidebarOpen: boolean;
}): void {
  globalThis.localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(params.sessions));
  globalThis.localStorage.setItem(STORAGE_KEYS.activeSessionId, params.activeSessionId);
  globalThis.localStorage.setItem(STORAGE_KEYS.activeProviderId, params.activeProviderId);
  globalThis.localStorage.setItem(STORAGE_KEYS.activeModelId, params.activeModelId);
  globalThis.localStorage.setItem(STORAGE_KEYS.draft, params.draft);
  globalThis.localStorage.setItem(STORAGE_KEYS.systemPrompt, params.systemPrompt);
  globalThis.localStorage.setItem(STORAGE_KEYS.temperature, String(params.temperature));
  globalThis.localStorage.setItem(STORAGE_KEYS.projects, JSON.stringify(params.projects));
  globalThis.localStorage.setItem(STORAGE_KEYS.activeProjectId, params.activeProjectId);
  globalThis.localStorage.setItem(STORAGE_KEYS.sidebarOpen, String(params.sidebarOpen));
}
