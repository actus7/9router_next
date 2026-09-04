"use client";

import { useCallback, useEffect, useState } from "react";
import type { HarnessLearningConfigView } from "@/shared/harness/agentMemory";
import type {
  AgentMemorySnapshot,
} from "@/shared/harness/agentMemory";
import type { HarnessPendingWrite } from "@/shared/harness/pendingWrites";

interface MemoryApiResponse extends AgentMemorySnapshot {
  ok?: boolean;
  config?: HarnessLearningConfigView;
}

export interface UseAgentMemoryReturn {
  snapshot: AgentMemorySnapshot | null;
  config: HarnessLearningConfigView | null;
  pending: HarnessPendingWrite[];
  loading: boolean;
  busy: boolean;
  error: string;
  reload: () => Promise<void>;
  saveConfig: (patch: Partial<HarnessLearningConfigView>) => Promise<void>;
  createEntry: (scope: "agent" | "user", content: string) => Promise<void>;
  updateEntry: (id: string, content: string) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  approvePending: (id: string) => Promise<void>;
  rejectPending: (id: string) => Promise<void>;
}

const EMPTY_SNAPSHOT: AgentMemorySnapshot = {
  revision: 0,
  agent: [],
  user: [],
  agentChars: 0,
  userChars: 0,
  agentLimit: 2200,
  userLimit: 1375,
};

export function useAgentMemory(open: boolean): UseAgentMemoryReturn {
  const [snapshot, setSnapshot] = useState<AgentMemorySnapshot | null>(null);
  const [config, setConfig] = useState<HarnessLearningConfigView | null>(null);
  const [pending, setPending] = useState<HarnessPendingWrite[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [memoryResp, pendingResp] = await Promise.all([
        fetch("/api/harness/memory", { cache: "no-store" }),
        fetch("/api/harness/pending", { cache: "no-store" }),
      ]);
      const memoryPayload = (await memoryResp.json().catch(() => null)) as MemoryApiResponse | null;
      const pendingPayload = (await pendingResp.json().catch(() => null)) as {
        pending?: HarnessPendingWrite[];
      } | null;
      if (!memoryResp.ok || !memoryPayload) {
        setError("Não foi possível carregar a memória.");
        return;
      }
      setSnapshot({
        revision: memoryPayload.revision,
        agent: memoryPayload.agent ?? [],
        user: memoryPayload.user ?? [],
        agentChars: memoryPayload.agentChars ?? 0,
        userChars: memoryPayload.userChars ?? 0,
        agentLimit: memoryPayload.agentLimit ?? 2200,
        userLimit: memoryPayload.userLimit ?? 1375,
      });
      setConfig(memoryPayload.config ?? null);
      setPending(pendingPayload?.pending ?? []);
    } catch {
      setError("Não foi possível carregar a memória.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const saveConfig = useCallback(
    async (patch: Partial<HarnessLearningConfigView>) => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/harness/memory", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ config: patch }),
        });
        const payload = (await response.json().catch(() => null)) as MemoryApiResponse | null;
        if (!response.ok) {
          setError("Não foi possível salvar as configurações.");
          return;
        }
        if (payload?.config) setConfig(payload.config);
        if (payload?.revision !== undefined) {
          setSnapshot((current) => ({
            ...(current ?? EMPTY_SNAPSHOT),
            revision: payload.revision,
            agent: payload.agent ?? current?.agent ?? [],
            user: payload.user ?? current?.user ?? [],
            agentChars: payload.agentChars ?? current?.agentChars ?? 0,
            userChars: payload.userChars ?? current?.userChars ?? 0,
          }));
        }
      } catch {
        setError("Não foi possível salvar as configurações.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const mutateEntry = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/harness/memory", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!response.ok) {
          setError(typeof payload?.error === "string" ? payload.error : "Falha ao salvar.");
          return;
        }
        await reload();
      } catch {
        setError("Falha ao salvar.");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const createEntry = useCallback(
    async (scope: "agent" | "user", content: string) => {
      await mutateEntry({ action: "create", scope, content });
    },
    [mutateEntry],
  );

  const updateEntry = useCallback(
    async (id: string, content: string) => {
      await mutateEntry({ action: "update", id, content });
    },
    [mutateEntry],
  );

  const deleteEntry = useCallback(
    async (id: string) => {
      await mutateEntry({ action: "delete", id });
    },
    [mutateEntry],
  );

  const approvePending = useCallback(
    async (id: string) => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/harness/pending", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, decision: "approve" }),
        });
        if (!response.ok) {
          setError("Não foi possível aprovar.");
          return;
        }
        await reload();
      } catch {
        setError("Não foi possível aprovar.");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const rejectPending = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await fetch("/api/harness/pending", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, decision: "reject" }),
        });
        await reload();
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  return {
    snapshot,
    config,
    pending,
    loading,
    busy,
    error,
    reload,
    saveConfig,
    createEntry,
    updateEntry,
    deleteEntry,
    approvePending,
    rejectPending,
  };
}
