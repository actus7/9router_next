"use client";

import { useCallback, useEffect, useState } from "react";
import ProviderConnectCard from "./components/ProviderConnectCard";
import DeployForm from "./components/DeployForm";
import DeploymentCard from "./components/DeploymentCard";
import { CLOUD_TOOL_CATALOG } from "./toolCatalog";

interface Connection {
  id: string;
  provider: string;
  externalUserEmail: string | null;
  externalOrgName: string | null;
}

interface Deployment {
  id: string;
  provider: string;
  toolId: string;
  status: "provisioning" | "healthy" | "failed" | "deleting";
  publicUrl: string | null;
  error: string | null;
}

interface ApiKey {
  id: string;
  key: string;
  name?: string;
}

const PROVIDER_META = [
  { id: "render" as const, label: "Render", hint: "Free tier com 750h/mês" },
  { id: "railway" as const, label: "Railway", hint: "Free tier com créditos mensais" },
];

export default function CloudPageClient() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [selectedToolId, ] = useState(CLOUD_TOOL_CATALOG[0]?.id ?? "");
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [connectionsRes, deploymentsRes, settingsRes, keysRes] = await Promise.all([
      fetch("/api/cloud/connections").then((r) => r.json()),
      fetch("/api/cloud/deployments").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()).catch(() => null),
      fetch("/api/keys").then((r) => r.json()).catch(() => null),
    ]);
    setConnections(connectionsRes.connections ?? []);
    setDeployments(deploymentsRes.deployments ?? []);
    setCloudEnabled(Boolean(settingsRes?.cloudEnabled));
    setApiKeys(keysRes?.keys ?? []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleConnect = async (provider: string, token: string) => {
    const res = await fetch(`/api/cloud/connections/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error ?? "Falha ao conectar" };
    await loadAll();
    return {};
  };

  const handleDisconnect = async (provider: string) => {
    const res = await fetch(`/api/cloud/connections/${provider}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setActionError(json?.error ?? "Falha na operação");
      return;
    }
    setActionError(null);
    await loadAll();
  };

  const handleDeploy = async (toolId: string, input: { provider: string; model: string; modelProvider: string; gatewayApiKey: string }) => {
    const res = await fetch("/api/cloud/deployments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolId, ...input }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setActionError(json?.error ?? "Falha na operação");
      return;
    }
    setActionError(null);
    await loadAll();
  };

  const handleRefresh = async (id: string) => {
    const res = await fetch(`/api/cloud/deployments/${id}/refresh`, { method: "POST" });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setActionError(json?.error ?? "Falha na operação");
      return;
    }
    setActionError(null);
    await loadAll();
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/cloud/deployments/${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setActionError(json?.error ?? "Falha na operação");
      return;
    }
    setActionError(null);
    await loadAll();
  };

  const selectedTool = CLOUD_TOOL_CATALOG.find((t) => t.id === selectedToolId) ?? CLOUD_TOOL_CATALOG[0];

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-semibold">Cloud Deploy</h1>
        <p className="text-sm text-text-muted">Provisione CLIs na nuvem em vez de rodá-las apenas na máquina local.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {PROVIDER_META.map((p) => (
          <ProviderConnectCard
            key={p.id}
            provider={p.id}
            label={p.label}
            hint={p.hint}
            connection={connections.find((c) => c.provider === p.id) ?? null}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        ))}
      </div>

      {!isLoading && CLOUD_TOOL_CATALOG.length === 0 && (
        <p className="text-sm text-text-muted">Nenhuma CLI com imagem headless disponível para deploy em nuvem no momento.</p>
      )}

      {selectedTool && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">{selectedTool.name}</h2>
            <DeployForm
              toolName={selectedTool.name}
              availableProviders={PROVIDER_META.map((p) => ({ ...p, connected: connections.some((c) => c.provider === p.id) }))}
              apiKeys={apiKeys}
              cloudEnabled={cloudEnabled}
              onDeploy={(input) => handleDeploy(selectedTool.id, input)}
            />
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Seus ambientes</h2>
            {actionError && <p className="text-sm text-destructive-foreground">{actionError}</p>}
            {deployments.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhum ambiente criado. Conecte um provedor, escolha o modelo e clique em Deploy.</p>
            ) : (
              deployments.map((d) => (
                <DeploymentCard
                  key={d.id}
                  deployment={d}
                  toolName={CLOUD_TOOL_CATALOG.find((t) => t.id === d.toolId)?.name ?? d.toolId}
                  onRefresh={handleRefresh}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
