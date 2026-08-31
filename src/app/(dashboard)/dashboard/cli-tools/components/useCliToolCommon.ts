"use client";

import { useState } from "react";

/**
 * Shared hook for fetching model aliases from the API.
 * Used by most ToolCard components.
 */
export function useModelAliases() {
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.error("Error fetching model aliases:", error);
    }
  };

  return { modelAliases, fetchModelAliases, setModelAliases };
}
