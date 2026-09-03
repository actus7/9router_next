"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentSkillDefinition } from "@/shared/harness/agentSkills";
import {
  formatInstallCount,
  skillLibraryPageUrl,
  type SkillLibrary,
  type SkillLibraryEntry,
} from "@/shared/harness/skillLibraries";

interface LibrarySearchResponse {
  ok?: boolean;
  libraries?: SkillLibrary[];
  skills?: SkillLibraryEntry[];
  query?: string;
  libraryId?: string;
  error?: string;
}

interface LibraryInstallResponse {
  ok?: boolean;
  installedId?: string;
  skills?: AgentSkillDefinition[];
  bundleSkillIds?: string[];
  error?: string;
}

export interface UseSkillLibraryOptions {
  installedSkillIds: Set<string>;
  onInstalled: (payload: {
    skills: AgentSkillDefinition[];
    bundleSkillIds: string[];
    installedId: string;
  }) => void;
}

export function useSkillLibrary({
  installedSkillIds,
  onInstalled,
}: UseSkillLibraryOptions) {
  const [open, setOpen] = useState(false);
  const [libraries, setLibraries] = useState<SkillLibrary[]>([]);
  const [skills, setSkills] = useState<SkillLibraryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [libraryId, setLibraryId] = useState("all");
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState("");
  const [error, setError] = useState("");
  const [lastInstalledId, setLastInstalledId] = useState("");

  const search = useCallback(async (nextQuery: string, nextLibraryId: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        library: nextLibraryId,
        limit: "24",
      });
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      const response = await fetch(`/api/harness/skills/library?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as LibrarySearchResponse | null;
      if (!response.ok || !payload?.skills) {
        setError(
          typeof payload?.error === "string"
            ? payload.error
            : "Não foi possível buscar a biblioteca.",
        );
        return;
      }
      setLibraries(payload.libraries ?? []);
      setSkills(payload.skills);
    } catch {
      setError("Não foi possível buscar a biblioteca.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      void search(query, libraryId);
    }, query.trim() ? 320 : 0);
    return () => window.clearTimeout(handle);
  }, [open, query, libraryId, search]);

  const install = useCallback(
    async (entry: SkillLibraryEntry) => {
      if (installedSkillIds.has(entry.skillId)) return;
      setInstallingId(entry.id);
      setError("");
      try {
        const response = await fetch("/api/harness/skills/library", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: entry.source,
            skillId: entry.skillId,
            enabled: false,
          }),
        });
        const payload = (await response.json().catch(() => null)) as LibraryInstallResponse | null;
        if (!response.ok || !payload?.installedId || !payload.skills) {
          setError(
            typeof payload?.error === "string"
              ? payload.error
              : "Instalação falhou.",
          );
          return;
        }
        setLastInstalledId(payload.installedId);
        onInstalled({
          skills: payload.skills,
          bundleSkillIds: payload.bundleSkillIds ?? [],
          installedId: payload.installedId,
        });
      } catch {
        setError("Instalação falhou.");
      } finally {
        setInstallingId("");
      }
    },
    [installedSkillIds, onInstalled],
  );

  const activeLibrary = useMemo(
    () => libraries.find((library) => library.id === libraryId),
    [libraries, libraryId],
  );

  return {
    open,
    setOpen,
    libraries,
    skills,
    query,
    setQuery,
    libraryId,
    setLibraryId,
    loading,
    installingId,
    error,
    lastInstalledId,
    activeLibrary,
    install,
    skillLibraryPageUrl,
    formatInstallCount,
  };
}
