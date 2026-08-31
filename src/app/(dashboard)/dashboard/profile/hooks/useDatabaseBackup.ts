"use client";

import { useState, useRef } from "react";
import { translate } from "@/i18n/runtime";
import type { Settings, StatusMessage } from "../types";

export function useDatabaseBackup(settings: Settings, setSettings: React.Dispatch<React.SetStateAction<Settings>>, reloadSettings: () => Promise<void>) {
  const [dbLoading, setDbLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<StatusMessage>({ type: "", message: "" });
  const [dbAuth, setDbAuth] = useState({ open: false, mode: "", password: "" });
  const pendingImportRef = useRef<File | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const handleExportDatabase = async (password: string) => {
    setDbLoading(true);
    setDbStatus({ type: "", message: "" });
    try {
      const res = await fetch("/api/settings/database", {
        headers: { "x-9r-password": password },
      });
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
    pendingImportRef.current = file;
    setDbStatus({ type: "", message: "" });
    setDbAuth({ open: true, mode: "import", password: "" });
  };

  const runImportDatabase = async (password: string) => {
    const file = pendingImportRef.current;
    if (!file) return;
    setDbLoading(true);
    try {
      const raw = await file.text();
      const payload = JSON.parse(raw);

      const res = await fetch("/api/settings/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, password }),
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
      pendingImportRef.current = null;
      setDbLoading(false);
    }
  };

  // Confirm password modal, then run export or import.
  const handleDbAuthConfirm = async () => {
    const { mode, password } = dbAuth;
    setDbAuth({ open: false, mode: "", password: "" });
    if (mode === "export") await handleExportDatabase(password);
    else if (mode === "import") await runImportDatabase(password);
  };

  return {
    dbLoading, setDbLoading,
    dbStatus, setDbStatus,
    dbAuth, setDbAuth,
    pendingImportRef, importFileRef,
    handleExportDatabase, handleImportDatabase, runImportDatabase, handleDbAuthConfirm,
  };
}
