"use client";

import { useState, useRef } from "react";
import { translate } from "@/i18n/runtime";
import type { StatusMessage } from "../types";

export function useDatabaseBackup(reloadSettings: () => Promise<void>) {
  const [dbLoading, setDbLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<StatusMessage>({ type: "", message: "" });
  // The import wipes this account's rows before restoring, so it still asks
  // first — the password it used to ask for was never checked by the route.
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const handleExportDatabase = async () => {
    setDbLoading(true);
    setDbStatus({ type: "", message: "" });
    try {
      const res = await fetch("/api/settings/database");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || translate("Failed to export database") || "Failed to export database");
      }

      const payload = await res.json();
      const content = JSON.stringify(payload, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[.:]/g, "-");
      anchor.href = url;
      anchor.download = `modelhub-backup-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      setDbStatus({ type: "success", message: translate("Database backup downloaded") || "Database backup downloaded" });
    } catch (err: unknown) {
      setDbStatus({ type: "error", message: err instanceof Error ? err.message : translate("Failed to export database") || "Failed to export database" });
    } finally {
      setDbLoading(false);
    }
  };

  const handleImportDatabase = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (importFileRef.current) importFileRef.current.value = "";
    if (!file) return;
    setDbStatus({ type: "", message: "" });
    setPendingImport(file);
  };

  const confirmImportDatabase = async () => {
    const file = pendingImport;
    setPendingImport(null);
    if (!file) return;
    setDbLoading(true);
    try {
      const payload = JSON.parse(await file.text());

      const res = await fetch("/api/settings/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || translate("Failed to import database") || "Failed to import database");
      }

      await reloadSettings();
      setDbStatus({ type: "success", message: translate("Database imported successfully") || "Database imported successfully" });
    } catch (err: unknown) {
      setDbStatus({ type: "error", message: err instanceof Error ? err.message : translate("Invalid backup file") || "Invalid backup file" });
    } finally {
      setDbLoading(false);
    }
  };

  return {
    dbLoading,
    dbStatus,
    pendingImport, setPendingImport,
    importFileRef,
    handleExportDatabase, handleImportDatabase, confirmImportDatabase,
  };
}
