"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { translate } from "@/i18n/runtime";
import { useNotificationStore } from "@/store/notificationStore";
import type { HarnessEvent } from "../types";

export interface UseHarnessEventsReturn {
  harnessEvents: HarnessEvent[];
  recordHarnessEvent: (sessionId: string, type: string, data: Record<string, unknown>) => void;
  showRunJournal: boolean;
  setShowRunJournal: React.Dispatch<React.SetStateAction<boolean>>;
}

// Owns the durable, ordered activity log ("run journal") for the active
// session: loads it when the session changes, and appends new events as
// they're recorded elsewhere (e.g. by the send-message flow).
export function useHarnessEvents(activeSessionId: string): UseHarnessEventsReturn {
  const notify = useNotificationStore();
  const [harnessEvents, setHarnessEvents] = useState<HarnessEvent[]>([]);
  const [showRunJournal, setShowRunJournal] = useState(false);
  const activeSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) {
      setHarnessEvents([]);
      return;
    }
    let cancelled = false;
    void fetch(`/api/harness/sessions/${encodeURIComponent(activeSessionId)}/events`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Failed to load run journal")))
      .then((data: Record<string, unknown>) => {
        if (!cancelled && Array.isArray(data.events)) setHarnessEvents(data.events as HarnessEvent[]);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Failed to load run journal:", error);
        setHarnessEvents([]);
        notify.warning(
          translate("Could not load run journal for this session.") ||
            "Could not load run journal for this session.",
        );
      });
    return () => { cancelled = true; };
  }, [activeSessionId, notify]);

  const recordHarnessEvent = useCallback((sessionId: string, type: string, data: Record<string, unknown>) => {
    void fetch(`/api/harness/sessions/${encodeURIComponent(sessionId)}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, data }),
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok && sessionId === activeSessionIdRef.current && payload.event && typeof payload.event === "object") {
        setHarnessEvents((previous) => [...previous, payload.event as HarnessEvent].sort((a, b) => a.seq - b.seq));
      }
    }).catch((error: unknown) => {
      console.error("Failed to record harness event:", error);
      notify.warning(
        translate("Could not save activity to run journal.") ||
          "Could not save activity to run journal.",
      );
    });
  }, [notify]);

  return { harnessEvents, recordHarnessEvent, showRunJournal, setShowRunJournal };
}
