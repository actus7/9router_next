import type { ChatSession, HarnessEvent } from "../types";

export type HarnessSettingsSection = "general" | "plugins" | "skills" | "memory" | "mcp" | "presets";

export interface HarnessSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: HarnessSettingsSection;
  onSectionChange: (section: HarnessSettingsSection) => void;
  session: ChatSession | null;
  harnessEvents?: HarnessEvent[];
  updateSession: (
    sessionId: string,
    updater: (session: ChatSession) => ChatSession,
  ) => void;
  systemPrompt: string;
  setSystemPrompt: React.Dispatch<React.SetStateAction<string>>;
  temperature: number;
  setTemperature: React.Dispatch<React.SetStateAction<number>>;
  conversationDisplay: "normal" | "compact";
  setConversationDisplay: React.Dispatch<
    React.SetStateAction<"normal" | "compact">
  >;
  enterBehavior: "queue" | "steer";
  setEnterBehavior: React.Dispatch<React.SetStateAction<"queue" | "steer">>;
}
