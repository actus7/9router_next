import { getAdapter } from "../driver";

export interface HarnessLearningConfig {
  memoryWriteApproval: boolean;
  memoryAgentEnabled: boolean;
  memoryUserEnabled: boolean;
  learningReviewEnabled: boolean;
  learningReviewModel: string;
  learningDeferWhenBusy: boolean;
  memoryNotifications: boolean;
}

const KEYS = {
  memoryWriteApproval: "harness.memory.writeApproval",
  memoryAgentEnabled: "harness.memory.agentEnabled",
  memoryUserEnabled: "harness.memory.userEnabled",
  learningReviewEnabled: "harness.learning.reviewEnabled",
  learningReviewModel: "harness.learning.reviewModel",
  learningDeferWhenBusy: "harness.learning.deferWhenBusy",
  memoryNotifications: "harness.memory.notifications",
} as const;

const DEFAULTS: HarnessLearningConfig = {
  memoryWriteApproval: false,
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
  const read = (key: string) => db.get("SELECT value FROM _meta WHERE key = ?", [key])?.value;
  return {
    memoryWriteApproval: readBool(read(KEYS.memoryWriteApproval), DEFAULTS.memoryWriteApproval),
    memoryAgentEnabled: readBool(read(KEYS.memoryAgentEnabled), DEFAULTS.memoryAgentEnabled),
    memoryUserEnabled: readBool(read(KEYS.memoryUserEnabled), DEFAULTS.memoryUserEnabled),
    learningReviewEnabled: readBool(read(KEYS.learningReviewEnabled), DEFAULTS.learningReviewEnabled),
    learningReviewModel: typeof read(KEYS.learningReviewModel) === "string"
      ? String(read(KEYS.learningReviewModel))
      : DEFAULTS.learningReviewModel,
    learningDeferWhenBusy: readBool(read(KEYS.learningDeferWhenBusy), DEFAULTS.learningDeferWhenBusy),
    memoryNotifications: readBool(read(KEYS.memoryNotifications), DEFAULTS.memoryNotifications),
  };
}

export async function updateHarnessLearningConfig(
  patch: Partial<HarnessLearningConfig>,
): Promise<HarnessLearningConfig> {
  const db = await getAdapter();
  const current = await getHarnessLearningConfig();
  const next = { ...current, ...patch };
  db.transaction(() => {
    const set = (key: string, value: string) => {
      db.run(
        "INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
      );
    };
    set(KEYS.memoryWriteApproval, String(next.memoryWriteApproval));
    set(KEYS.memoryAgentEnabled, String(next.memoryAgentEnabled));
    set(KEYS.memoryUserEnabled, String(next.memoryUserEnabled));
    set(KEYS.learningReviewEnabled, String(next.learningReviewEnabled));
    set(KEYS.learningReviewModel, next.learningReviewModel);
    set(KEYS.learningDeferWhenBusy, String(next.learningDeferWhenBusy));
    set(KEYS.memoryNotifications, String(next.memoryNotifications));
  });
  return next;
}
