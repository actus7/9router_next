"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, Zap, CheckCircle2, AlertCircle } from "lucide-react";
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
  { id: "render" as const, label: "Render", hint: "Free tier com 750h/mês", description: "Hospede com escalabilidade automática" },
  { id: "railway" as const, label: "Railway", hint: "Free tier com créditos mensais", description: "Deploy simplificado com CLI integrada" },
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
  const connectedProviders = connections.map(c => c.provider);
  const hasConnections = connectedProviders.length > 0;

  return (
    <div className="flex flex-col gap-8 p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Cloud className="size-6 text-accent" />
          <h1 className="text-2xl font-semibold">Cloud Deploy</h1>
        </div>
        <p className="text-sm text-text-muted">Provisione CLIs na nuvem de forma segura. Comece conectando um provedor cloud.</p>
      </div>

      {/* Step 1: Connect Providers */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center size-8 rounded-full bg-accent/20 text-accent font-semibold text-sm">1</div>
          <h2 className="text-lg font-semibold">Conecte um provedor cloud</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PROVIDER_META.map((p) => (
            <ProviderConnectCard
              key={p.id}
              provider={p.id}
              label={p.label}
              hint={p.hint}
              description={p.description}
              connection={connections.find((c) => c.provider === p.id) ?? null}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
          ))}
        </div>
      </section>

      {/* Step 2: Configure Deploy */}
      {hasConnections && selectedTool && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center size-8 rounded-full bg-accent/20 text-accent font-semibold text-sm">2</div>
            <h2 className="text-lg font-semibold">Configure o deploy</h2>
          </div>
          <div className="rounded-lg border border-border bg-surface/30 p-6">
            <h3 className="text-base font-medium mb-4">{selectedTool.name}</h3>
            <DeployForm
              toolName={selectedTool.name}
              availableProviders={PROVIDER_META.map((p) => ({ ...p, connected: connections.some((c) => c.provider === p.id) }))}
              apiKeys={apiKeys}
              cloudEnabled={cloudEnabled}
              onDeploy={(input) => handleDeploy(selectedTool.id, input)}
            />
          </div>
        </section>
      )}

      {!isLoading && CLOUD_TOOL_CATALOG.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface/20 p-8 text-center">
          <Zap className="size-8 mx-auto mb-3 text-text-muted opacity-50" />
          <p className="text-sm text-text-muted">Nenhuma CLI com imagem headless disponível para deploy em nuvem.</p>
        </div>
      )}

      {/* Step 3: View Deployments */}
      {deployments.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center size-8 rounded-full bg-accent/20 text-accent font-semibold text-sm">3</div>
            <h2 className="text-lg font-semibold">Seus ambientes ({deployments.length})</h2>
          </div>
          {actionError && (
            <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <AlertCircle className="size-5 text-destructive mt-0.5 flex-shrink-0" />
              <p className="text-sm text-destructive-foreground">{actionError}</p>
            </div>
          )}
          <div className="space-y-3">
            {deployments.map((d) => (
              <DeploymentCard
                key={d.id}
                deployment={d}
                toolName={CLOUD_TOOL_CATALOG.find((t) => t.id === d.toolId)?.name ?? d.toolId}
                onRefresh={handleRefresh}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </section>
      )}

      {hasConnections && deployments.length === 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center size-8 rounded-full bg-accent/20 text-accent font-semibold text-sm">3</div>
            <h2 className="text-lg font-semibold">Seus ambientes</h2>
          </div>
          <div className="rounded-lg border border-dashed border-border bg-surface/20 p-8 text-center">
            <CheckCircle2 className="size-8 mx-auto mb-3 text-text-muted opacity-50" />
            <p className="text-sm text-text-muted">Configure o deploy acima para criar seu primeiro ambiente.</p>
          </div>
        </section>
      )}
    </div>
  );
}
