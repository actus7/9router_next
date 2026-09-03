const STORAGE_KEY = "harness.skillPreferences";
const SESSIONS_STORAGE_KEY = "basic-chat.sessions";

export type SkillPreferenceMap = Record<string, boolean>;

const listeners = new Set<() => void>();

const EMPTY_PREFERENCES: SkillPreferenceMap = {};

// `useSyncExternalStore` compares snapshots by reference, so parsing the stored
// JSON on every read would report a new store value on every render. The parsed
// map is kept alongside the raw string it came from and only rebuilt when that
// string changes, which also covers writes made by another tab.
let cachedRaw: string | null = null;
let cachedSnapshot: SkillPreferenceMap = EMPTY_PREFERENCES;
let cacheFilled = false;

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function migrateFromStoredSessions(): SkillPreferenceMap {
  if (typeof window === "undefined") return {};
  const sessions = safeParseJson<Array<{
    skillOverrides?: SkillPreferenceMap;
    updatedAt?: string;
    createdAt?: string;
  }> | null>(window.localStorage.getItem(SESSIONS_STORAGE_KEY), null);
  if (!Array.isArray(sessions)) return {};

  let latest: SkillPreferenceMap = {};
  let latestTime = 0;
  for (const session of sessions) {
    if (!session?.skillOverrides || typeof session.skillOverrides !== "object") {
      continue;
    }
    const timestamp = Date.parse(session.updatedAt ?? session.createdAt ?? "");
    const time = Number.isFinite(timestamp) ? timestamp : 0;
    if (time >= latestTime) {
      latestTime = time;
      latest = { ...session.skillOverrides };
    }
  }
  return latest;
}

function fillCache(raw: string | null, snapshot: SkillPreferenceMap): SkillPreferenceMap {
  cachedRaw = raw;
  cachedSnapshot = snapshot;
  cacheFilled = true;
  return snapshot;
}

export function readSkillPreferences(): SkillPreferenceMap {
  if (typeof window === "undefined") return EMPTY_PREFERENCES;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (cacheFilled && raw === cachedRaw) return cachedSnapshot;

  const stored = safeParseJson<SkillPreferenceMap | null>(raw, null);
  if (stored && typeof stored === "object") return fillCache(raw, stored);

  const migrated = migrateFromStoredSessions();
  if (Object.keys(migrated).length === 0) return fillCache(raw, migrated);

  const serialized = JSON.stringify(migrated);
  window.localStorage.setItem(STORAGE_KEY, serialized);
  return fillCache(serialized, migrated);
}

export function writeSkillPreference(skillId: string, enabled: boolean): SkillPreferenceMap {
  if (typeof window === "undefined") return EMPTY_PREFERENCES;
  const next = { ...readSkillPreferences(), [skillId]: enabled };
  const serialized = JSON.stringify(next);
  window.localStorage.setItem(STORAGE_KEY, serialized);
  fillCache(serialized, next);
  listeners.forEach((listener) => listener());
  return next;
}

export function subscribeSkillPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resolveSkillSessionEnabled(
  skill: { id: string; enabled: boolean },
  preferences?: SkillPreferenceMap,
  sessionOverrides?: SkillPreferenceMap,
): boolean {
  const prefs = preferences ?? readSkillPreferences();
  const decision = prefs[skill.id] ?? sessionOverrides?.[skill.id];
  return decision !== undefined ? decision : skill.enabled;
}
