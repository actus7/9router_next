"use client";

import { useEffect, useState } from "react";
import {
  setActiveHarnessCatalog,
  type HarnessCatalog,
} from "@/shared/harness/agentPlugins";
import { layersAllow } from "@/shared/access/accessPolicy";
import { myAccessLayers, useWorkspace } from "@/shared/hooks/useWorkspace";

// Publishes the server's composed plugin catalogue to the browser.
//
// Resolution functions read from a module-level active catalogue so every
// existing call site keeps its signature. That variable is not reactive, so the
// hook also returns a counter the page holds in state: bumping it re-renders
// the components whose output depends on the catalogue once it arrives. Until
// then they resolve against the bundle defaults, which is the correct fallback.
//
// A tool plugin the member's access policy does not grant is left out of the
// published catalogue, so the chat neither lists nor offers it. The worker
// strips its tool from the run body as well (withoutForbiddenPluginTools);
// this is the half that keeps the screen honest about it.

interface PluginsResponse {
  catalog?: HarnessCatalog;
}

export function useHarnessCatalog(): number {
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState<HarnessCatalog | null>(null);
  const { workspace } = useWorkspace();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/harness/plugins", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: PluginsResponse | null) => {
        const fetched = payload?.catalog;
        if (!cancelled && fetched?.plugins?.length) setCatalog(fetched);
      })
      .catch(() => {
        // The bundle defaults are already active; a failed fetch changes nothing.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!catalog) return;
    const layers = myAccessLayers(workspace);
    const plugins = catalog.plugins.filter((plugin) => plugin.kind !== "tool" || layersAllow(layers, "plugins", [plugin.id]));
    setActiveHarnessCatalog(plugins.length === catalog.plugins.length ? catalog : { ...catalog, plugins });
    setRevision((current) => current + 1);
  }, [catalog, workspace]);

  return revision;
}
