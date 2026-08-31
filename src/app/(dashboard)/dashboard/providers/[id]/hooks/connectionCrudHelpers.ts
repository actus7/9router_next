"use client";

import { translate } from "@/i18n/runtime";
import type { Connection, ConfirmState } from "../types";

interface ConnectionCrudArgs {
  setConnections: React.Dispatch<React.SetStateAction<Connection[]>>;
  setConfirmState: React.Dispatch<React.SetStateAction<ConfirmState | null>>;
  selectedConnectionIds: string[];
  setSelectedConnectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  notify: { warning: (msg: string) => void };
}

export function createConnectionCrud({
  setConnections, setConfirmState, selectedConnectionIds, setSelectedConnectionIds, notify,
}: ConnectionCrudArgs) {
  const handleDelete = async (id: string) => {
    setConfirmState({
      title: translate("Delete connection") || "Delete connection",
      message: translate("Delete this connection?") || "Delete this connection?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
          if (res.ok) setConnections(prev => prev.filter(c => c.id !== id));
        } catch (error) { console.error("Error deleting connection:", error); }
      }
    });
  };

  const handleBulkDelete = () => {
    const count = selectedConnectionIds.length;
    if (count === 0) return;
    setConfirmState({
      title: translate("Delete") + ` ${count} ` + translate("Connection(s)") || `Delete ${count} connection(s)`,
      message: translate("Delete") + ` ${count} ` + translate("connection(s)") + "? " + translate("This cannot be undone.") || `Delete ${count} connection(s)? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmState(null);
        let failed = 0;
        const idsToDelete = [...selectedConnectionIds];
        for (const id of idsToDelete) {
          try {
            const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
            if (!res.ok) failed += 1;
          } catch (error) { console.error("Error deleting connection:", error); failed += 1; }
        }
        setConnections(prev => prev.filter(c => !idsToDelete.includes(c.id)));
        setSelectedConnectionIds([]);
        if (failed > 0) notify.warning(translate("Deleted") + ` ${idsToDelete.length - failed} ` + translate("connection(s)") + `, ${failed} ` + translate("failed") + ".");
      }
    });
  };

  const handleUpdateConnectionStatus = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
      if (res.ok) setConnections(prev => prev.map(c => c.id === id ? { ...c, isActive } : c));
    } catch (error) { console.error("Error updating connection status:", error); }
  };

  const handleSwapPriority = async (connections: Connection[], index1: number, index2: number, fetchConnections: () => Promise<void>) => {
    const newConnections = [...connections];
    [newConnections[index1], newConnections[index2]] = [newConnections[index2], newConnections[index1]];
    setConnections(newConnections);
    try {
      await Promise.all([
        fetch(`/api/providers/${newConnections[index1].id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: index1 }) }),
        fetch(`/api/providers/${newConnections[index2].id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: index2 }) }),
      ]);
    } catch (error) { console.error("Error swapping priority:", error); await fetchConnections(); }
  };

  return { handleDelete, handleBulkDelete, handleUpdateConnectionStatus, handleSwapPriority };
}
