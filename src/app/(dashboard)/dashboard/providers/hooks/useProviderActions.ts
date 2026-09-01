"use client";

import { useNotificationStore } from "@/store/notificationStore";
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
  const notify = useNotificationStore();

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
    setConnections((prev) =>
      prev.map((c) => (matches(c) ? { ...c, isActive: newActive } : c)),
    );
    await Promise.allSettled(
      providerConns.map((c) =>
        fetch(`/api/providers/${c.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: newActive }),
        }),
      ),
    );
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
        if (failed === 0) notify.success(translate("All") + ` ${total} ` + translate("tests passed"));
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
