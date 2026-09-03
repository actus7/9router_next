"use client";

import { useEffect, useState } from "react";
import {
  setActiveHarnessCatalog,
  type HarnessCatalog,
} from "@/shared/harness/agentPlugins";

// Publishes the server's composed plugin catalogue to the browser.
//
// Resolution functions read from a module-level active catalogue so every
// existing call site keeps its signature. That variable is not reactive, so the
// hook also returns a counter the page holds in state: bumping it re-renders
// the components whose output depends on the catalogue once it arrives. Until
// then they resolve against the bundle defaults, which is the correct fallback.

interface PluginsResponse {
  catalog?: HarnessCatalog;
}

export function useHarnessCatalog(): number {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/harness/plugins", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: PluginsResponse | null) => {
        const catalog = payload?.catalog;
        if (cancelled || !catalog?.plugins?.length) return;
        setActiveHarnessCatalog(catalog);
        setRevision((current) => current + 1);
      })
      .catch(() => {
        // The bundle defaults are already active; a failed fetch changes nothing.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return revision;
}
