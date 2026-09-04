export type PendingWriteKind = "memory" | "skill" | "plugin";
export type PendingWriteSource = "agent" | "review";
export type PendingWriteStatus = "pending" | "applied" | "accepted" | "rejected";

interface PendingWriteBase {
  id: string;
  source: PendingWriteSource;
  status: PendingWriteStatus;
  reviewedAt?: string;
  result?: Record<string, unknown>;
  createdAt: string;
}

export interface PendingMemoryWrite extends PendingWriteBase {
  kind: "memory";
  action: "add" | "replace" | "remove";
  payload: {
    scope?: "agent" | "user";
    id?: string;
    content?: string;
    reason?: string;
    runId?: string;
  };
}

export interface PendingPluginToggle extends PendingWriteBase {
  kind: "plugin";
  action: "toggle";
  payload: { pluginId: string; enabled: boolean };
}

export interface PendingCapabilityProposal extends PendingWriteBase {
  kind: "plugin";
  action: "propose";
  payload: { title: string; description: string; toolName: string };
}

export interface PendingSkillWrite extends PendingWriteBase {
  kind: "skill";
  action: string;
  payload: Record<string, unknown>;
}

export type HarnessPendingWrite =
  | PendingMemoryWrite
  | PendingPluginToggle
  | PendingCapabilityProposal
  | PendingSkillWrite;

export type NewHarnessPendingWrite = HarnessPendingWrite extends infer Write
  ? Write extends HarnessPendingWrite
    ? Omit<Write, "createdAt" | "status" | "reviewedAt" | "result">
    : never
  : never;
