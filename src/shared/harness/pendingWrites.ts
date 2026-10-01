export type PendingWriteKind = "memory" | "skill" | "plugin";
type PendingWriteSource = "agent" | "review";
export type PendingWriteStatus =
  | "pending"
  | "applied"
  | "accepted"
  | "rejected"
  | "auto_applied";

/**
 * Jev's reading of how risky a write is, 0 (harmless) to 3 (high). Shown to
 * the operator beside the approve button. In the `auto` write-risk mode a
 * confidently-low score also approves the write outright; everything else
 * waits for the operator as before.
 */
export interface PendingWriteRisk {
  score: number;
  /** Jev's calibration for the score, 0..1. Auto-apply only trusts ≥ 0.9. */
  confidence?: number;
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
