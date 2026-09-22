export type PendingWriteKind = "memory" | "skill" | "plugin";
type PendingWriteSource = "agent" | "review";
export type PendingWriteStatus = "pending" | "applied" | "accepted" | "rejected";

/**
 * Jev's reading of how risky a write is, 0 (harmless) to 3 (high). Shown to
 * the operator beside the approve button; it never approves or rejects.
 */
export interface PendingWriteRisk {
  score: number;
  model: string;
}

interface PendingWriteBase {
  id: string;
  risk?: PendingWriteRisk;
  source: PendingWriteSource;
  status: PendingWriteStatus;
  reviewedAt?: string;
  result?: Record<string, unknown>;
  createdAt: string;
}

interface PendingMemoryWrite extends PendingWriteBase {
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

interface PendingPluginToggle extends PendingWriteBase {
  kind: "plugin";
  action: "toggle";
  payload: { pluginId: string; enabled: boolean };
}

interface PendingCapabilityProposal extends PendingWriteBase {
  kind: "plugin";
  action: "propose";
  payload: { title: string; description: string; toolName: string };
}

interface PendingSkillWrite extends PendingWriteBase {
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
