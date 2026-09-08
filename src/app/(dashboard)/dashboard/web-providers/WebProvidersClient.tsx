"use client";

import { SearchX } from "lucide-react";
import { useProviderData } from "../providers/hooks/useProviderData";
import { AvailabilityFilterBar } from "../providers/components/AvailabilityFilterBar";
import { ApiKeyProviderCard } from "../providers/components/ApiKeyProviderCard";
import { ProviderSection } from "../providers/components/ProviderSection";
import { Modals } from "../providers/components/Modals";
import type { Connection } from "../providers/types";
import { ExtensionInstallGuide } from "./components/ExtensionInstallGuide";

export default function WebProvidersClient({ initialConnections }: { initialConnections: Connection[] }) {
  const d = useProviderData(initialConnections, []);
  const entries = d.filterEntries(d.webCookieEntries, "other", "cookie");
  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <ExtensionInstallGuide />
      <AvailabilityFilterBar availabilityFilter={d.availabilityFilter} onFilterChange={d.setAvailabilityFilter} />
      <ProviderSection title="Web Session Providers" testMode="cookie" testLabel="Testar sessões" testAriaLabel="Testar todas as conexões de sessão web" testingMode={d.testingMode} onTest={d.handleBatchTest}
        description="Escolha um serviço para conectar, validar ou renovar sua sessão. A captura por extensão aparece nos providers compatíveis; a entrada manual continua disponível em todos.">
        {entries.map(([id, provider]) => <ApiKeyProviderCard key={id} providerId={id} provider={provider} stats={d.getStats(id, "cookie")} onToggle={(active) => d.handleToggleProvider(id, "cookie", active)} availability={d.availabilityFor(provider)} />)}
      </ProviderSection>
      {entries.length === 0 && <div role="status" className="flex flex-col items-center gap-2 py-8 text-muted-foreground"><SearchX className="size-6" aria-hidden="true" /><p>Nenhum provider corresponde aos filtros.</p></div>}
      <Modals showAddCompatibleModal={false} onCloseAddCompatible={() => {}} showAddAnthropicCompatibleModal={false} onCloseAddAnthropicCompatible={() => {}} onNodeCreated={() => {}} testResults={d.testResults} onCloseTestResults={() => d.setTestResults(null)} />
    </div>
  );
}
