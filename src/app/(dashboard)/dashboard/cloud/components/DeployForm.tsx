"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import ApiKeySelect from "../../cli-tools/components/ApiKeySelect";
import { Loader2 } from "lucide-react";

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
    <div className="flex flex-col gap-4">
      <div>
        <label className="text-sm font-medium">Onde hospedar</label>
        <Select value={provider} onValueChange={(v) => v && setProvider(v)}>
          <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
          <SelectContent>
            {connectedProviders.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label htmlFor="modelProvider" className="text-sm font-medium">Provider do modelo</label>
        <Input
          id="modelProvider"
          type="text"
          placeholder="Ex: openai, anthropic, google"
          value={modelProvider}
          onChange={(e) => setModelProvider(e.target.value)}
          className="mt-1.5"
        />
        <p className="text-xs text-text-muted mt-1.5">Nome do provedor de IA que será usado</p>
      </div>

      <div>
        <label htmlFor="model" className="text-sm font-medium">Modelo</label>
        <Input
          id="model"
          type="text"
          placeholder="Ex: gpt-4o, claude-3-sonnet"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="mt-1.5"
        />
        <p className="text-xs text-text-muted mt-1.5">Modelo específico do provider</p>
      </div>

      <div>
        <label className="text-sm font-medium">Chave de API</label>
        <div className="mt-1.5">
          <ApiKeySelect value={apiKey} onChange={setApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
        </div>
      </div>

      <Button onClick={handleDeploy} disabled={!canDeploy} size="lg" className="mt-2">
        {isDeploying && <Loader2 className="size-4 mr-2 animate-spin" />}
        {isDeploying ? "Fazendo deploy..." : `Fazer deploy de ${toolName}`}
      </Button>
    </div>
  );
}
