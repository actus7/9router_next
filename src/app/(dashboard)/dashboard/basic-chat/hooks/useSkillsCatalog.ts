"use client";

import { useEffect, useState } from "react";
import {
  setActiveSkillCatalog,
  type SkillCatalog,
} from "@/shared/harness/agentSkills";

interface SkillsResponse {
  skills?: SkillCatalog["skills"];
}

export function useSkillsCatalog(): number {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/harness/skills", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: SkillsResponse | null) => {
        if (cancelled || !payload?.skills?.length) return;
        setActiveSkillCatalog({ skills: payload.skills });
        setRevision((current) => current + 1);
      })
      .catch(() => {
        /* bundle defaults remain active */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return revision;
}
