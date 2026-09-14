"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";

export function useMetaBreak() {
  const { data, error: loadError, mutate } = useSWR<Record<string, unknown>>("/api/settings", jsonFetcher);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const pending = useRef(false);

  const handleEnabled = async (enabled: boolean) => {
    if (pending.current || !data) return;
    pending.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metaBreakEnabled: enabled }),
      });
      if (!response.ok) throw new Error("settings-save-failed");
      const saved = await response.json();
      if (saved.metaBreakEnabled !== enabled) throw new Error("settings-not-persisted");
      await mutate(current => ({ ...current, ...saved }), { revalidate: false });
    } catch {
      setSaveError(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return { enabled: data?.metaBreakEnabled === true, saving, loading: !data, error: saveError ? "save" : loadError ? "load" : null, handleEnabled };
}
