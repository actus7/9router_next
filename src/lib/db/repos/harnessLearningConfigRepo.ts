import { getAdapter } from "../driver";
import { getTenantMeta, setTenantMeta } from "../helpers/tenantMeta";

export interface HarnessLearningConfig {
  memoryWriteApproval: boolean;
  /**
   * Gate agent-initiated skill writes behind operator approval.
   *
   * Defaults ON, unlike memory. A memory entry is something the agent
   * remembers; a skill is an instruction the agent then follows, injected into
   * the system prompt of every later run. If only one of the two is gated by
   * default it has to be the more powerful one — and the agent already cannot
   * toggle a plugin without approval, so letting it write its own standing
   * instructions unchecked was the inconsistent case.
   */
  skillWriteApproval: boolean;
  memoryAgentEnabled: boolean;
  memoryUserEnabled: boolean;
  learningReviewEnabled: boolean;
  learningReviewModel: string;
  learningDeferWhenBusy: boolean;
  memoryNotifications: boolean;
}

const KEYS = {
  memoryWriteApproval: "harness.memory.writeApproval",
  skillWriteApproval: "harness.skill.writeApproval",
  memoryAgentEnabled: "harness.memory.agentEnabled",
  memoryUserEnabled: "harness.memory.userEnabled",
  learningReviewEnabled: "harness.learning.reviewEnabled",
  learningReviewModel: "harness.learning.reviewModel",
  learningDeferWhenBusy: "harness.learning.deferWhenBusy",
  memoryNotifications: "harness.memory.notifications",
} as const;

const DEFAULTS: HarnessLearningConfig = {
  memoryWriteApproval: false,
  skillWriteApproval: true,
  memoryAgentEnabled: true,
  memoryUserEnabled: true,
  learningReviewEnabled: false,
  learningReviewModel: "",
  learningDeferWhenBusy: true,
  memoryNotifications: true,
};

function readBool(value: unknown, fallback: boolean): boolean {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return fallback;
}

export async function getHarnessLearningConfig(): Promise<HarnessLearningConfig> {
  const db = await getAdapter();
  const read = (key: string) => getTenantMeta(db, key);
  const reviewModel = await read(KEYS.learningReviewModel);
  return {
    memoryWriteApproval: readBool(await read(KEYS.memoryWriteApproval), DEFAULTS.memoryWriteApproval),
    skillWriteApproval: readBool(await read(KEYS.skillWriteApproval), DEFAULTS.skillWriteApproval),
    memoryAgentEnabled: readBool(await read(KEYS.memoryAgentEnabled), DEFAULTS.memoryAgentEnabled),
    memoryUserEnabled: readBool(await read(KEYS.memoryUserEnabled), DEFAULTS.memoryUserEnabled),
    learningReviewEnabled: readBool(await read(KEYS.learningReviewEnabled), DEFAULTS.learningReviewEnabled),
    learningReviewModel: reviewModel ?? DEFAULTS.learningReviewModel,
    learningDeferWhenBusy: readBool(await read(KEYS.learningDeferWhenBusy), DEFAULTS.learningDeferWhenBusy),
    memoryNotifications: readBool(await read(KEYS.memoryNotifications), DEFAULTS.memoryNotifications),
  };
}

export async function updateHarnessLearningConfig(
  patch: Partial<HarnessLearningConfig>,
): Promise<HarnessLearningConfig> {
  const db = await getAdapter();
  const current = await getHarnessLearningConfig();
  const next = { ...current, ...patch };
  await db.transaction(async () => {
    await setTenantMeta(db, KEYS.memoryWriteApproval, next.memoryWriteApproval);
    await setTenantMeta(db, KEYS.skillWriteApproval, next.skillWriteApproval);
    await setTenantMeta(db, KEYS.memoryAgentEnabled, next.memoryAgentEnabled);
    await setTenantMeta(db, KEYS.memoryUserEnabled, next.memoryUserEnabled);
    await setTenantMeta(db, KEYS.learningReviewEnabled, next.learningReviewEnabled);
    await setTenantMeta(db, KEYS.learningReviewModel, next.learningReviewModel);
    await setTenantMeta(db, KEYS.learningDeferWhenBusy, next.learningDeferWhenBusy);
    await setTenantMeta(db, KEYS.memoryNotifications, next.memoryNotifications);
  });
  return next;
}
