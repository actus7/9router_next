"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";

/**
 * The observability switch: governs whether full request/response bodies are
 * recorded. One hook so the tab header switch and the drawer's inline switch
 * read and write the same setting (SWR dedupes the key).
 */
export default function useObservability() {
  const { data: settings, mutate: mutateSettings } = useSWR<{ enableObservability?: boolean }>(
    "/api/settings",
    jsonFetcher,
  );
  const observabilityOn = settings?.enableObservability === true;

  const setObservability = useCallback(
    async (enabled: boolean) => {
      await mutateSettings(
        async (current) => {
          const res = await fetch("/api/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enableObservability: enabled }),
          });
          if (!res.ok) throw new Error(`Request failed (${res.status})`);
          return { ...current, enableObservability: enabled };
        },
        {
          optimisticData: { ...settings, enableObservability: enabled },
          revalidate: false,
          rollbackOnError: true,
        },
      );
    },
    [mutateSettings, settings],
  );

  return { settings, observabilityOn, setObservability };
}
