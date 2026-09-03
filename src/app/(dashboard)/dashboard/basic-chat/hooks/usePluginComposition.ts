"use client";

import { useCallback, useEffect, useState } from "react";
import { setActiveHarnessCatalog, type HarnessCatalog } from "@/shared/harness/agentPlugins";

// Install-wide plugin composition: which rows the tree resolved, where each one
// came from, and which stored rows were ignored. Editing here writes the patch
// layer, so a change outlives the conversation and the process.

export interface CompositionRow {
  id: string;
  plugin: string;
  config: Record<string, unknown>;
  position: number;
  origin: "bundle" | "override" | "user";
}

export interface CompositionDiagnostic {
  rowId: string;
  reason: string;
}

interface CompositionResponse {
  revision: number;
  rows: CompositionRow[];
  diagnostics: CompositionDiagnostic[];
  bundleRowIds: string[];
  catalog: HarnessCatalog;
}

export interface UsePluginCompositionReturn {
  rows: CompositionRow[];
  diagnostics: CompositionDiagnostic[];
  bundleRowIds: string[];
  loading: boolean;
  busyId: string;
  error: string;
  /** Writes an override row that disables a bundle row, or re-enables it. */
  setRowEnabled: (row: CompositionRow, enabled: boolean) => Promise<void>;
  /** Drops the stored override so the row falls back to its bundle default. */
  resetRow: (id: string) => Promise<void>;
}

export function usePluginComposition(open: boolean): UsePluginCompositionReturn {
  const [rows, setRows] = useState<CompositionRow[]>([]);
  const [diagnostics, setDiagnostics] = useState<CompositionDiagnostic[]>([]);
  const [bundleRowIds, setBundleRowIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const adopt = useCallback((payload: CompositionResponse) => {
    setRows(payload.rows ?? []);
    setDiagnostics(payload.diagnostics ?? []);
    setBundleRowIds(payload.bundleRowIds ?? []);
    if (payload.catalog?.plugins?.length) setActiveHarnessCatalog(payload.catalog);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/harness/plugins", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as CompositionResponse | null;
      if (!response.ok || !payload) {
        setError("Não foi possível carregar a composição de plugins.");
        return;
      }
      adopt(payload);
    } catch {
      setError("Não foi possível carregar a composição de plugins.");
    } finally {
      setLoading(false);
    }
  }, [adopt]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const write = useCallback(
    async (id: string, request: RequestInit | undefined, url: string) => {
      setBusyId(id);
      setError("");
      try {
        const response = await fetch(url, request);
        const payload = (await response.json().catch(() => null)) as
          | (CompositionResponse & { error?: string })
          | null;
        if (!response.ok || !payload) {
          setError(payload?.error || "A alteração não foi aplicada.");
          return;
        }
        adopt(payload);
      } catch {
        setError("A alteração não foi aplicada.");
      } finally {
        setBusyId("");
      }
    },
    [adopt],
  );

  const setRowEnabled = useCallback(
    async (row: CompositionRow, enabled: boolean) => {
      await write(
        row.id,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: row.id,
            plugin: row.plugin,
            config: row.config,
            position: row.position,
            enabled,
            // Source is inferred server-side from whether the id targets a
            // bundle row, so the client cannot mislabel an insert as a patch.
          }),
        },
        "/api/harness/plugins",
      );
    },
    [write],
  );

  const resetRow = useCallback(
    async (id: string) => {
      await write(id, { method: "DELETE" }, `/api/harness/plugins?id=${encodeURIComponent(id)}`);
    },
    [write],
  );

  return { rows, diagnostics, bundleRowIds, loading, busyId, error, setRowEnabled, resetRow };
}
