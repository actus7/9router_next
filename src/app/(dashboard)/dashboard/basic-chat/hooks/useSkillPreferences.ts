"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  readSkillPreferences,
  subscribeSkillPreferences,
  writeSkillPreference,
  type SkillPreferenceMap,
} from "@/shared/harness/skillPreferences";

// Preferences live in localStorage, so the server and the hydrating render must
// agree on an empty map, and it has to be the same object every time or
// useSyncExternalStore treats each render as a store change.
const HYDRATION_SNAPSHOT: SkillPreferenceMap = {};

export function useSkillPreferences() {
  const preferences = useSyncExternalStore(
    subscribeSkillPreferences,
    readSkillPreferences,
    () => HYDRATION_SNAPSHOT,
  );

  const setSkillEnabled = useCallback((skillId: string, enabled: boolean) => {
    writeSkillPreference(skillId, enabled);
  }, []);

  return { preferences, setSkillEnabled };
}
