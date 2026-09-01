"use client";

import { useState, useEffect } from "react";

export function useCursorAuth(isOpen: boolean) {
  const [accessToken, setAccessToken] = useState("");
  const [machineId, setMachineId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [windowsManual, setWindowsManual] = useState(false);

  const runAutoDetect = async () => {
    setAutoDetecting(true); setError(null); setAutoDetected(false); setWindowsManual(false);
    try {
      const res = await fetch("/api/oauth/cursor/auto-import");
      const data = await res.json();
      if (data.found) { setAccessToken(data.accessToken); setMachineId(data.machineId); setAutoDetected(true); }
      else if (data.windowsManual) { setWindowsManual(true); }
      else { setError(data.error || "Could not auto-detect tokens"); }
    } catch { setError("Failed to auto-detect tokens");
    } finally { setAutoDetecting(false); }
  };

  useEffect(() => { if (isOpen) runAutoDetect(); }, [isOpen]);

  const handleImportToken = async (onSuccess?: () => void, onClose?: () => void) => {
    if (!accessToken.trim()) { setError("Please enter an access token"); return; }
    if (!machineId.trim()) { setError("Please enter a machine ID"); return; }
    setImporting(true); setError(null);
    try {
      const res = await fetch("/api/oauth/cursor/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: accessToken.trim(), machineId: machineId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      onSuccess?.(); onClose?.();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err));
    } finally { setImporting(false); }
  };

  return {
    accessToken, setAccessToken, machineId, setMachineId,
    error, importing, autoDetecting, autoDetected, windowsManual,
    runAutoDetect, handleImportToken,
  };
}
