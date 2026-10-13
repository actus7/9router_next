"use client";

import { useEffect, useState } from "react";
import {
  setActiveSkillCatalog,
  type SkillCatalog,
} from "@/shared/harness/agentSkills";
import { filterAllowed } from "@/shared/access/accessPolicy";
import { myAccessLayers, useWorkspace } from "@/shared/hooks/useWorkspace";

interface SkillsResponse {
  skills?: SkillCatalog["skills"];
}

/**
 * Publishes the account's skills to the chat, minus the ones the member's
 * access policy does not grant: they are neither described to the model nor
 * offered in the composer. `load_skill` refuses them on the server regardless.
 */
export function useSkillsCatalog(): number {
  const [revision, setRevision] = useState(0);
  const [skills, setSkills] = useState<SkillCatalog["skills"] | null>(null);
  const { workspace } = useWorkspace();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/harness/skills", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: SkillsResponse | null) => {
        if (!cancelled && payload?.skills?.length) setSkills(payload.skills);
      })
      .catch(() => {
        /* bundle defaults remain active */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!skills) return;
    const allowed = new Set(filterAllowed(myAccessLayers(workspace), "skills", skills.map((skill) => skill.id)));
    setActiveSkillCatalog({ skills: skills.filter((skill) => allowed.has(skill.id)) });
    setRevision((current) => current + 1);
  }, [skills, workspace]);

  return revision;
}
