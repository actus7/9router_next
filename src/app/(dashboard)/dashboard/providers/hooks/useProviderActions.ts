"use client";

import { notify } from "@/store/notificationStore";
import { translate } from "@/i18n/runtime";
import { normalizeProviderId } from "@/lib/providerNormalization";
import type { Connection, TestResults } from "../types";

export function useProviderActions(
  connections: Connection[],
  setConnections: React.Dispatch<React.SetStateAction<Connection[]>>,
  testingMode: string | null,
  setTestingMode: React.Dispatch<React.SetStateAction<string | null>>,
  setTestResults: React.Dispatch<React.SetStateAction<TestResults | null>>,
) {

  const handleToggleProvider = async (
    providerId: string,
    authType: string | string[],
    newActive: boolean,
  ) => {
    const authTypes = Array.isArray(authType) ? authType : [authType];
    const matches = (c: Connection) =>
      normalizeProviderId(c.provider) === providerId &&
      authTypes.includes(c.authType || "");
    const providerConns = connections.filter(matches);
    const previousActive = new Map(providerConns.map((c) => [c.id, c.isActive]));
    setConnections((prev) =>
      prev.map((c) => (matches(c) ? { ...c, isActive: newActive } : c)),
    );
    const results = await Promise.allSettled(
      providerConns.map(async (c) => {
        const res = await fetch(`/api/providers/${c.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: newActive }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }),
    );
    const failedIds = new Set(
      providerConns.filter((_, i) => results[i].status === "rejected").map((c) => c.id),
    );
    if (failedIds.size === 0) return;
    setConnections((prev) =>
      prev.map((c) => (failedIds.has(c.id) ? { ...c, isActive: previousActive.get(c.id) } : c)),
    );
    notify.error(translate("Failed to update provider") || "Failed to update provider");
  };

  const handleBatchTest = async (mode: string, providerId: string | null = null) => {
    if (testingMode) return;
    setTestingMode(mode === "provider" ? providerId : mode);
    setTestResults(null);
    try {
      const res = await fetch("/api/providers/test-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, providerId }),
      });
      const data = await res.json();
      setTestResults(data);
      if (data.summary) {
        const { passed, failed, total } = data.summary;
        if (total === 0) notify.info(translate("No connections to test") || "No connections to test");
        else if (failed === 0) notify.success(translate("All") + ` ${total} ` + translate("tests passed"));
        else notify.warning(`${passed}/${total} ` + translate("passed") + `, ${failed} ` + translate("failed"));
      }
    } catch  {
      setTestResults({ error: translate("Test request failed") || "Test request failed" });
      notify.error(translate("Provider test failed") || "Provider test failed");
    } finally {
      setTestingMode(null);
    }
  };

  return { handleToggleProvider, handleBatchTest };
}
