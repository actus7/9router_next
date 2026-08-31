"use client";

import { Checkbox } from "@/components/ui/checkbox";
import ConnectionRow from "../../ConnectionRow";
import { AUTO_PING_SETTINGS_KEYS } from "../../hooks/useProviderConnections";
import type { Connection, ProxyPool } from "../../types";

interface AutoPingState {
  connections: Record<string, boolean>;
}

interface OneByOneResult {
  state: string;
  error?: string | null;
}

interface ConnectionsListProps {
  connections: Connection[];
  isSelected: (id: string) => boolean;
  setSelectedConnectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  proxyPools: ProxyPool[];
  isOAuth: boolean;
  providerId: string;
  autoPing: AutoPingState;
  handleAutoPingConnection: (id: string, on: boolean) => void;
  handleSwapPriority: (i1: number, i2: number) => void;
  handleUpdateConnectionStatus: (id: string, isActive: boolean) => void;
  setSelectedConnection: (conn: Connection) => void;
  setShowEditModal: (show: boolean) => void;
  handleDelete: (id: string) => void;
  oneByOneResults: Record<string, OneByOneResult>;
  onUpdateProxy: (connId: string, proxyPoolId: string | null) => Promise<void>;
}

export default function ConnectionsList({
  connections,
  isSelected,
  setSelectedConnectionIds,
  proxyPools,
  isOAuth,
  providerId,
  autoPing,
  handleAutoPingConnection,
  handleSwapPriority,
  handleUpdateConnectionStatus,
  setSelectedConnection,
  setShowEditModal,
  handleDelete,
  oneByOneResults,
  onUpdateProxy,
}: ConnectionsListProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface divide-y divide-black/[0.03] dark:divide-white/[0.03]">
      {connections.map((conn, index) => (
        <div key={conn.id} className="flex min-w-0 items-stretch">
          <div className="flex shrink-0 items-center pl-1 sm:pl-2">
            <Checkbox
              checked={isSelected(conn.id)}
              onCheckedChange={(checked) => {
                if (checked === true) {
                  setSelectedConnectionIds((prev) => [...prev, conn.id]);
                } else {
                  setSelectedConnectionIds((prev) => prev.filter((id) => id !== conn.id));
                }
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <ConnectionRow
              connection={conn}
              proxyPools={proxyPools}
              isOAuth={isOAuth}
              isFirst={index === 0}
              isLast={index === connections.length - 1}
              onMoveUp={() => handleSwapPriority(index, index - 1)}
              onMoveDown={() => handleSwapPriority(index, index + 1)}
              onToggleActive={(isActive) => handleUpdateConnectionStatus(conn.id, isActive)}
              autoPing={AUTO_PING_SETTINGS_KEYS[providerId] && conn.authType === "oauth" ? {
                on: autoPing.connections[conn.id] === true,
                onToggle: (on) => handleAutoPingConnection(conn.id, on),
                provider: providerId,
              } : null}
              onUpdateProxy={async (proxyPoolId) => onUpdateProxy(conn.id, proxyPoolId)}
              onEdit={() => {
                setSelectedConnection(conn);
                setShowEditModal(true);
              }}
              onDelete={() => handleDelete(conn.id)}
              oneByOneStatus={oneByOneResults[conn.id] || null}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
