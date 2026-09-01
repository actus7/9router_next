"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import ApiKeySelect from "../../cli-tools/components/ApiKeySelect";

interface ApiKey {
  id: string;
  key: string;
  name?: string;
}

interface DeployFormProps {
  toolName: string;
  availableProviders: Array<{ id: "render" | "railway"; label: string; connected: boolean }>;
  apiKeys: ApiKey[];
  cloudEnabled: boolean;
  onDeploy: (input: { provider: string; model: string; modelProvider: string; gatewayApiKey: string }) => Promise<void>;
}

export default function DeployForm({ toolName, availableProviders, apiKeys, cloudEnabled, onDeploy }: DeployFormProps) {
  const connectedProviders = availableProviders.filter((p) => p.connected);
  const [provider, setProvider] = useState(connectedProviders[0]?.id ?? "");
  const [model, setModel] = useState("");
  const [modelProvider, setModelProvider] = useState("");
  const [apiKey, setApiKey] = useState(apiKeys[0]?.key ?? "");
  const [isDeploying, setIsDeploying] = useState(false);

  const canDeploy = provider && model.trim() && modelProvider.trim() && apiKey && !isDeploying;

  const handleDeploy = async () => {
    if (!canDeploy) return;
    setIsDeploying(true);
    try {
      await onDeploy({ provider, model: model.trim(), modelProvider: modelProvider.trim(), gatewayApiKey: apiKey });
    } finally {
      setIsDeploying(false);
    }
  };

  if (connectedProviders.length === 0) {
    return <p className="text-sm text-text-muted">Conecte um provedor cloud acima para fazer deploy do {toolName}.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Select value={provider} onValueChange={(v) => v && setProvider(v)}>
        <SelectTrigger><SelectValue placeholder="Onde hospedar" /></SelectTrigger>
        <SelectContent>
          {connectedProviders.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <input
        className="rounded-md border border-border bg-surface/40 px-3 py-2 text-sm"
        placeholder="Provider do agente (ex: openai)"
        value={modelProvider}
        onChange={(e) => setModelProvider(e.target.value)}
      />
      <input
        className="rounded-md border border-border bg-surface/40 px-3 py-2 text-sm"
        placeholder="Modelo (ex: gpt-4o)"
        value={model}
        onChange={(e) => setModel(e.target.value)}
      />
      <ApiKeySelect value={apiKey} onChange={setApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
      <Button onClick={handleDeploy} disabled={!canDeploy}>
        {isDeploying ? "Fazendo deploy..." : `Deploy ${toolName}`}
      </Button>
    </div>
  );
}
