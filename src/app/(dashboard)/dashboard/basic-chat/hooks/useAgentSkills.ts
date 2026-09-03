"use client";

import { useCallback, useEffect, useState } from "react";
import {
  setActiveSkillCatalog,
  type AgentSkillDefinition,
} from "@/shared/harness/agentSkills";

export interface SkillDraft {
  id: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  source?: "user" | "imported" | "override";
  origin?: string;
}

interface SkillsApiResponse {
  revision: number;
  skills: AgentSkillDefinition[];
  diagnostics: Array<{ rowId: string; reason: string }>;
  bundleSkillIds: string[];
}

export interface UseAgentSkillsReturn {
  skills: AgentSkillDefinition[];
  bundleSkillIds: Set<string>;
  loading: boolean;
  busyId: string;
  error: string;
  reload: () => Promise<void>;
  setGlobalEnabled: (skill: AgentSkillDefinition, enabled: boolean) => Promise<void>;
  saveSkill: (draft: SkillDraft) => Promise<void>;
  removeSkill: (id: string) => Promise<void>;
  importFromUrl: (url: string) => Promise<SkillDraft>;
  exportMarkdown: (skill: AgentSkillDefinition) => string;
}

export function useAgentSkills(open: boolean): UseAgentSkillsReturn {
  const [skills, setSkills] = useState<AgentSkillDefinition[]>([]);
  const [bundleSkillIds, setBundleSkillIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const adopt = useCallback((payload: SkillsApiResponse) => {
    setSkills(payload.skills ?? []);
    setBundleSkillIds(new Set(payload.bundleSkillIds ?? []));
    if (payload.skills?.length) setActiveSkillCatalog({ skills: payload.skills });
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/harness/skills", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as SkillsApiResponse | null;
      if (!response.ok || !payload) {
        setError("Não foi possível carregar as skills.");
        return;
      }
      adopt(payload);
    } catch {
      setError("Não foi possível carregar as skills.");
    } finally {
      setLoading(false);
    }
  }, [adopt]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const setGlobalEnabled = useCallback(
    async (skill: AgentSkillDefinition, enabled: boolean) => {
      setBusyId(skill.id);
      setError("");
      try {
        const response = await fetch("/api/harness/skills", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            body: skill.body,
            enabled,
            source: skill.bundled ? "override" : skill.origin,
          }),
        });
        const payload = (await response.json().catch(() => null)) as SkillsApiResponse | null;
        if (!response.ok || !payload) {
          setError("Não foi possível atualizar a skill.");
          return;
        }
        adopt(payload);
      } catch {
        setError("Não foi possível atualizar a skill.");
      } finally {
        setBusyId("");
      }
    },
    [adopt],
  );

  const saveSkill = useCallback(
    async (draft: SkillDraft) => {
      setBusyId(draft.id);
      setError("");
      try {
        const response = await fetch("/api/harness/skills", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: draft.id,
            name: draft.name,
            description: draft.description,
            body: draft.body,
            enabled: draft.enabled,
            source: draft.source ?? "user",
            origin: draft.origin,
          }),
        });
        const payload = (await response.json().catch(() => null)) as SkillsApiResponse | null;
        if (!response.ok || !payload) {
          const errPayload = payload as { error?: string } | null;
          setError(
            typeof errPayload?.error === "string"
              ? errPayload.error
              : "Não foi possível salvar a skill.",
          );
          return;
        }
        adopt(payload);
      } catch {
        setError("Não foi possível salvar a skill.");
      } finally {
        setBusyId("");
      }
    },
    [adopt],
  );

  const removeSkill = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError("");
      try {
        const response = await fetch(
          `/api/harness/skills?id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        const payload = (await response.json().catch(() => null)) as SkillsApiResponse | null;
        if (!response.ok || !payload) {
          setError("Não foi possível remover a skill.");
          return;
        }
        adopt(payload);
      } catch {
        setError("Não foi possível remover a skill.");
      } finally {
        setBusyId("");
      }
    },
    [adopt],
  );

  const importFromUrl = useCallback(async (url: string): Promise<SkillDraft> => {
    setError("");
    const response = await fetch("/api/harness/skills/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      draft?: SkillDraft;
      error?: string;
    } | null;
    if (!response.ok || !payload?.draft) {
      throw new Error(
        typeof payload?.error === "string"
          ? payload.error
          : "Importação falhou",
      );
    }
    return payload.draft;
  }, []);

  const exportMarkdown = useCallback((skill: AgentSkillDefinition) => {
    const description =
      skill.description.includes("\n") || skill.description.includes(":")
        ? `"${skill.description.replace(/"/g, '\\"')}"`
        : skill.description;
    return `---\nname: ${skill.id}\ndescription: ${description}\n---\n\n${skill.body.trim()}\n`;
  }, []);

  return {
    skills,
    bundleSkillIds,
    loading,
    busyId,
    error,
    reload,
    setGlobalEnabled,
    saveSkill,
    removeSkill,
    importFromUrl,
    exportMarkdown,
  };
}
