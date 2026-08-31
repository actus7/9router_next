"use client";

import { useState, useCallback } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import { translate } from "@/i18n/runtime";
import type { ProxyPool } from "../types";

export function useProxyImport(proxyPools: ProxyPool[], fetchProxyPools: () => Promise<void>) {
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);
  const [batchImportText, setBatchImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const notify = useNotificationStore();

  const openBatchImportModal = () => {
    setBatchImportText("");
    setShowBatchImportModal(true);
  };

  const closeBatchImportModal = () => {
    if (importing) return;
    setShowBatchImportModal(false);
  };

  const parseProxyLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (trimmed.includes("://")) {
      const parsed = new URL(trimmed);
      const hostLabel = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
      return {
        proxyUrl: parsed.toString(),
        name: `Imported ${hostLabel}`,
      };
    }

    const parts = trimmed.split(":");
    if (parts.length === 4) {
      const [host, port, username, password] = parts;
      if (!host || !port || !username || !password) {
        throw new Error("Invalid host:port:user:pass format");
      }

      const proxyUrl = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
      const parsed = new URL(proxyUrl);
      return {
        proxyUrl: parsed.toString(),
        name: `Imported ${host}:${port}`,
      };
    }

    throw new Error("Unsupported format");
  };

  const handleBatchImport = async () => {
    const lines = batchImportText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      notify.warning(translate("Please paste at least one proxy line.") || "Please paste at least one proxy line.");
      return;
    }

    const parsedEntries: { proxyUrl: string; name: string; lineNumber: number }[] = [];
    const invalidLines: string[] = [];

    lines.forEach((line, index) => {
      try {
        const parsed = parseProxyLine(line);
        if (parsed) {
          parsedEntries.push({
            ...parsed,
            lineNumber: index + 1,
          });
        }
      } catch (error: unknown) {
        invalidLines.push(`Line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    if (invalidLines.length > 0) {
      notify.error(`${translate("Invalid proxy format:") || "Invalid proxy format:"}\n${invalidLines.join("\n")}`);
      return;
    }

    setImporting(true);
    try {
      const existingKeys = new Set(
        proxyPools.map((pool) => `${(pool.proxyUrl || "").trim()}|||${(pool.noProxy || "").trim()}`)
      );

      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (const entry of parsedEntries) {
        const dedupeKey = `${entry.proxyUrl}|||`;
        if (existingKeys.has(dedupeKey)) {
          skipped += 1;
          continue;
        }

        const res = await fetch("/api/proxy-pools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: entry.name,
            proxyUrl: entry.proxyUrl,
            noProxy: "",
            isActive: true,
          }),
        });

        if (res.ok) {
          created += 1;
          existingKeys.add(dedupeKey);
        } else {
          failed += 1;
        }
      }

      await fetchProxyPools();
      setShowBatchImportModal(false);
      notify.success(`${translate("Batch import completed:") || "Batch import completed:"} ${translate("Created") || "Created"} ${created}, ${translate("Skipped") || "Skipped"} ${skipped}, ${translate("Failed") || "Failed"} ${failed}`);
    } catch (error) {
      console.error("Error batch importing proxies:", error);
      notify.error(translate("Batch import failed") || "Batch import failed");
    } finally {
      setImporting(false);
    }
  };

  return {
    showBatchImportModal, batchImportText, setBatchImportText, importing,
    openBatchImportModal, closeBatchImportModal, handleBatchImport,
  };
}
