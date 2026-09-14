"use client";

import { useCallback, useEffect, useState } from "react";
import { getModelsByProviderId } from "@/shared/llm-catalog";
import { getProviderLabel, isConnectionSelectable } from "../../basic-chat/chatModelUtils";

export interface DeployModelProvider {
  id: string;
  label: string;
  models: Array<{ id: string; name: string }>;
}

interface FreeGroup {
  providerId: string;
  providerName: string;
  models: Array<{ id: string; name: string }>;
}

// A deployed CLI talks to this gateway (the deploy route hands the container a
// gatewayApiUrl + gatewayApiKey), never to the provider directly. So anything
// the gateway can route is deployable — including free-tier providers, which
// hold no row in providerConnections. Reading only /api/providers listed none
// of them and told accounts with 65 usable providers they had zero.
export function useDeployModelProviders() {
  const [providers, setProviders] = useState<DeployModelProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    const [connectionsData, freeData] = await Promise.all([
      fetch("/api/providers", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/models/free", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);

    const byId = new Map<string, DeployModelProvider>();

    const connections: Array<Record<string, unknown>> = Array.isArray(connectionsData?.connections)
      ? connectionsData.connections
      : [];
    for (const connection of connections.filter(isConnectionSelectable)) {
      const id = connection.provider as string;
      if (!id || byId.has(id)) continue;
      const models = getModelsByProviderId(id)
        .map((m) => ({ id: String(m.id ?? ""), name: String(m.name ?? m.id ?? "") }))
        .filter((m) => m.id);
      if (models.length) byId.set(id, { id, label: getProviderLabel(connection), models });
    }

    const freeGroups: FreeGroup[] = Array.isArray(freeData?.groups) ? freeData.groups : [];
    for (const group of freeGroups) {
      if (!group.providerId || byId.has(group.providerId)) continue;
      const models = (group.models ?? [])
        .map((m) => ({ id: String(m.id ?? ""), name: String(m.name ?? m.id ?? "") }))
        .filter((m) => m.id);
      if (models.length) {
        byId.set(group.providerId, { id: group.providerId, label: group.providerName || group.providerId, models });
      }
    }

    setProviders([...byId.values()].sort((a, b) => a.label.localeCompare(b.label)));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { modelProviders: providers, isLoadingModelProviders: isLoading };
}
