"use client";

import { Button } from "@/components/ui/button";
import { ChevronDown, SearchX } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { getProviderConnectionAuthTypes } from "@/shared/constants/providers";
import { useProviderData } from "./hooks/useProviderData";
import { AvailabilityFilterBar } from "./components/AvailabilityFilterBar";
import { CustomProvidersSection } from "./components/CustomProvidersSection";
import { ProviderSection } from "./components/ProviderSection";
import { ProviderCard } from "./components/ProviderCard";
import { ApiKeyProviderCard } from "./components/ApiKeyProviderCard";
import { Modals } from "./components/Modals";
import type { ProvidersClientProps, ProviderNode } from "./types";

export default function ProvidersClient({ initialConnections, initialNodes }: ProvidersClientProps) {
  const d = useProviderData(initialConnections, initialNodes);
  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <AvailabilityFilterBar availabilityFilter={d.availabilityFilter} onFilterChange={d.setAvailabilityFilter} />
      {!d.hasAnyResult && (
        <div className="text-center py-8 border border-dashed border-border rounded-xl">
          <SearchX className="size-8" />
          <p className="text-text-muted text-sm">{translate("No providers match your search")}</p>
        </div>
      )}
      <CustomProvidersSection compatibleProviders={d.compatibleProviders} anthropicCompatibleProviders={d.anthropicCompatibleProviders} getStats={d.getStats} onToggle={d.handleToggleProvider} onAddOpenAI={() => d.setShowAddCompatibleModal(true)} onAddAnthropic={() => d.setShowAddAnthropicCompatibleModal(true)} />
      {d.oauthEntries.length > 0 && (
        <ProviderSection title={translate("OAuth Providers")} testMode="oauth" testLabel="Test all OAuth connections" testAriaLabel="Test all OAuth connections" testingMode={d.testingMode} onTest={d.handleBatchTest}>
          {d.filterEntries(d.oauthEntries, "other", "oauth").map(([key, info]) => {
            const authTypes = getProviderConnectionAuthTypes(info);
            return <ProviderCard key={key} providerId={key} provider={info} stats={d.getStats(key, authTypes)} onToggle={(active) => d.handleToggleProvider(key, authTypes, active)} availability={d.availabilityFor(info)} />;
          })}
        </ProviderSection>
      )}
      {(d.freeEntries.length > 0 || d.freeTierEntries.length > 0) && (
        <ProviderSection title={translate("Free Tier Providers")} testMode="free" testLabel="Test all Free connections" testAriaLabel="Test all Free provider connections" testingMode={d.testingMode} onTest={d.handleBatchTest}>
          {d.filterEntries(d.freeEntries, "free", ["oauth", "apikey", "api_key"]).map(([key, info]) => {
            const freeAuthTypes = getProviderConnectionAuthTypes(info);
            return <ProviderCard key={key} providerId={key} provider={info} stats={d.getStats(key, freeAuthTypes)} onToggle={(active) => d.handleToggleProvider(key, freeAuthTypes, active)} availability={d.availabilityFor(info)} />;
          })}
          {d.filterEntries(d.freeTierEntries, "freeTier", ["oauth", "apikey", "api_key"]).map(([key, info]) => {
            const freeAuthTypes = getProviderConnectionAuthTypes(info);
            return <ApiKeyProviderCard key={key} providerId={key} provider={info} stats={d.getStats(key, freeAuthTypes)} onToggle={(active) => d.handleToggleProvider(key, freeAuthTypes, active)} availability={d.availabilityFor(info)} />;
          })}
        </ProviderSection>
      )}
      {d.apikeyEntries.length > 0 && (
        <ProviderSection title={translate("API Key Providers")} testMode="apikey" testLabel="Test all API Key connections" testAriaLabel="Test all API Key connections" testingMode={d.testingMode} onTest={d.handleBatchTest}
          footer={!d.isApikeySearching && !d.showAllApikey && d.hiddenApikeyCount > 0 ? (
            <Button variant="outline" onClick={() => d.setShowAllApikey(true)} className="w-full border-dashed border-primary/40 text-primary hover:border-primary hover:bg-primary/5">
              <ChevronDown className="size-4" />{translate("Show all")} {d.apikeyEntries.length} {translate("providers")}
            </Button>
          ) : undefined}
        >
          {d.filterEntries(d.visibleApikeyEntries, "other", "apikey").map(([key, info]) => (
            <ApiKeyProviderCard key={key} providerId={key} provider={info} stats={d.getStats(key, "apikey")} onToggle={(active) => d.handleToggleProvider(key, "apikey", active)} availability={d.availabilityFor(info)} />
          ))}
        </ProviderSection>
      )}
      {d.webCookieEntries.length > 0 && (
        <ProviderSection
          title={translate("Web Session Providers")}
          testMode="cookie"
          testLabel="Test all Web Session connections"
          testAriaLabel="Test all Web Session connections"
          testingMode={d.testingMode}
          onTest={d.handleBatchTest}
          description={translate("Guided setup imports session from a copied browser request.") || "Guided setup imports session from a copied browser request."}
        >
          {d.filterEntries(d.webCookieEntries, "other", "cookie").map(([key, info]) => (
            <ApiKeyProviderCard key={key} providerId={key} provider={info} stats={d.getStats(key, "cookie")} onToggle={(active) => d.handleToggleProvider(key, "cookie", active)} availability={d.availabilityFor(info)} />
          ))}
        </ProviderSection>
      )}
      <Modals showAddCompatibleModal={d.showAddCompatibleModal} onCloseAddCompatible={() => d.setShowAddCompatibleModal(false)} showAddAnthropicCompatibleModal={d.showAddAnthropicCompatibleModal} onCloseAddAnthropicCompatible={() => d.setShowAddAnthropicCompatibleModal(false)} onNodeCreated={(node: ProviderNode) => { d.setProviderNodes((prev) => [...prev, node]); }} testResults={d.testResults} onCloseTestResults={() => d.setTestResults(null)} />
    </div>
  );
}
