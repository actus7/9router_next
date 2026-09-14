"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import ApiKeySelect from "../../cli-tools/components/ApiKeySelect";
import { Loader2 } from "lucide-react";
import type { DeployModelProvider } from "../hooks/useDeployModelProviders";

interface ApiKey {
  id: string;
  key: string;
  name?: string;
}

interface DeployFormProps {
  toolName: string;
  availableProviders: Array<{ id: "render" | "railway"; label: string; connected: boolean }>;
  modelProviders: DeployModelProvider[];
  isLoadingModelProviders: boolean;
  apiKeys: ApiKey[];
  cloudEnabled: boolean;
  onDeploy: (input: { provider: string; model: string; modelProvider: string; gatewayApiKey: string }) => Promise<void>;
}

export default function DeployForm({ toolName, availableProviders, modelProviders, isLoadingModelProviders, apiKeys, cloudEnabled, onDeploy }: DeployFormProps) {
  const connectedProviders = availableProviders.filter((p) => p.connected);
  const [provider, setProvider] = useState(connectedProviders[0]?.id ?? "");
  const [modelProvider, setModelProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState(apiKeys[0]?.key ?? "");
  const [isDeploying, setIsDeploying] = useState(false);

  // A disconnected provider must not stay selected: the value survives the
  // options it came from, and canDeploy only checks for a non-empty string.
  useEffect(() => {
    if (!connectedProviders.some((p) => p.id === provider)) {
      setProvider(connectedProviders[0]?.id ?? "");
    }
  }, [connectedProviders, provider]);

  useEffect(() => {
    if (!apiKey && apiKeys.length) setApiKey(apiKeys[0].key);
  }, [apiKeys, apiKey]);

  const availableModels = useMemo(
    () => modelProviders.find((p) => p.id === modelProvider)?.models ?? [],
    [modelProviders, modelProvider],
  );

  // The model list follows the provider: a stale selection (provider switched
  // upstream or the catalog refetched) must not survive as a hidden value.
  useEffect(() => {
    if (model && !availableModels.some((m) => m.id === model)) setModel("");
  }, [availableModels, model]);

  const canDeploy = provider && model && modelProvider && apiKey && !isDeploying;

  const handleDeploy = async () => {
    if (!canDeploy) return;
    setIsDeploying(true);
    try {
      await onDeploy({ provider, model, modelProvider, gatewayApiKey: apiKey });
    } finally {
      setIsDeploying(false);
    }
  };

  if (connectedProviders.length === 0) {
    return <p className="text-sm text-text-muted">Conecte um provedor cloud acima para fazer deploy do {toolName}.</p>;
  }

  if (isLoadingModelProviders) {
    return <p className="text-sm text-text-muted">Carregando provedores de modelo…</p>;
  }

  if (modelProviders.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        Nenhum provedor de modelo ativo. Conecte um — ou verifique os que falharam no teste — em{" "}
        <Link href="/dashboard/providers" className="text-info font-semibold hover:underline">
          Provedores
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="deploy-provider" className="text-sm font-medium">Onde hospedar</label>
        <Select value={provider} onValueChange={(v) => v && setProvider(v)}>
          <SelectTrigger id="deploy-provider" className="mt-1.5"><SelectValue /></SelectTrigger>
          <SelectContent>
            {connectedProviders.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label htmlFor="deploy-model-provider" className="text-sm font-medium">Provider do modelo</label>
        <Select value={modelProvider} onValueChange={(v) => {
          if (v) {
            setModelProvider(v);
            setModel(""); // Reset model when provider changes
          }
        }}>
          <SelectTrigger id="deploy-model-provider" className="mt-1.5"><SelectValue placeholder="Selecione um provider" /></SelectTrigger>
          <SelectContent>
            {modelProviders.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-text-muted mt-1.5">Os mesmos provedores disponíveis no seu chat</p>
      </div>

      <div>
        <label htmlFor="deploy-model" className="text-sm font-medium">Modelo</label>
        <Select value={model} onValueChange={(v) => v && setModel(v)} disabled={!modelProvider}>
          <SelectTrigger id="deploy-model" className="mt-1.5">
            <SelectValue placeholder={modelProvider ? "Selecione um modelo" : "Escolha um provider primeiro"} />
          </SelectTrigger>
          <SelectContent>
            {availableModels.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name || m.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-text-muted mt-1.5">Modelos disponíveis para esse provider</p>
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
