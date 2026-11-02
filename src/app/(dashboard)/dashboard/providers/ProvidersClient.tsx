"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ChevronDown, SearchX } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { getProviderConnectionAuthTypes } from "@/shared/constants/providers";
import { useProviderData } from "./hooks/useProviderData";
import { providerHref } from "./hooks/computeProviderEntries";
import { AvailabilityFilterBar } from "./components/AvailabilityFilterBar";
import { CustomProvidersSection } from "./components/CustomProvidersSection";
import { ProviderSection } from "./components/ProviderSection";
import { ProviderCard } from "./components/ProviderCard";
import { ApiKeyProviderCard } from "./components/ApiKeyProviderCard";
import { TypesafeProviderCard } from "./components/TypesafeProviderCard";
import { TYPESAFE_PROVIDER } from "./typesafeProvider";
import { Modals } from "./components/Modals";
import type { ProvidersClientProps, ProviderNode } from "./types";

export default function ProvidersClient({ initialConnections, initialNodes, hasTypesafeKey }: ProvidersClientProps) {
  const d = useProviderData(initialConnections, initialNodes, hasTypesafeKey);
  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <AvailabilityFilterBar availabilityFilter={d.availabilityFilter} onFilterChange={d.setAvailabilityFilter} kindFilter={d.kindFilter} onToggleKind={d.toggleKind} onClearKinds={() => d.setKindFilter([])} />
      {!d.hasAnyResult && (
        <div className="text-center py-8 border border-dashed border-border rounded-xl">
          <SearchX className="size-8" />
          <p className="text-text-muted text-sm">{translate("No providers match your search")}</p>
        </div>
      )}
      {d.showCustom && <CustomProvidersSection compatibleProviders={d.compatibleProviders} anthropicCompatibleProviders={d.anthropicCompatibleProviders} getStats={d.getStats} onToggle={d.handleToggleProvider} onAddOpenAI={() => d.setShowAddCompatibleModal(true)} onAddAnthropic={() => d.setShowAddAnthropicCompatibleModal(true)} />}
      {d.oauthVisible.length > 0 && (
        <ProviderSection title={translate("OAuth Providers")} testMode="oauth" testLabel="Test all OAuth connections" testAriaLabel="Test all OAuth connections" testingMode={d.testingMode} onTest={d.handleBatchTest}>
          {d.filterEntries(d.oauthEntries, "other", "oauth").map(([key, info]) => {
            const authTypes = getProviderConnectionAuthTypes(info);
            return <ProviderCard key={key} providerId={key} provider={info} stats={d.getStats(key, authTypes)} onToggle={(active) => d.handleToggleProvider(key, authTypes, active)} availability={d.availabilityFor(info)} href={providerHref(key, info, d.kindFilter)} />;
          })}
        </ProviderSection>
      )}
      {(d.freeVisible.length > 0 || d.freeTierVisible.length > 0) && (
        <ProviderSection title={translate("Free Tier Providers")} testMode="free" testLabel="Test all Free connections" testAriaLabel="Test all Free provider connections" testingMode={d.testingMode} onTest={d.handleBatchTest}>
          {d.filterEntries(d.freeEntries, "free", ["oauth", "apikey", "api_key"]).map(([key, info]) => {
            const freeAuthTypes = getProviderConnectionAuthTypes(info);
            return <ProviderCard key={key} providerId={key} provider={info} stats={d.getStats(key, freeAuthTypes)} onToggle={(active) => d.handleToggleProvider(key, freeAuthTypes, active)} availability={d.availabilityFor(info)} href={providerHref(key, info, d.kindFilter)} />;
          })}
          {d.filterEntries(d.freeTierEntries, "freeTier", ["oauth", "apikey", "api_key"]).map(([key, info]) => {
            const freeAuthTypes = getProviderConnectionAuthTypes(info);
            return <ApiKeyProviderCard key={key} providerId={key} provider={info} stats={d.getStats(key, freeAuthTypes)} onToggle={(active) => d.handleToggleProvider(key, freeAuthTypes, active)} availability={d.availabilityFor(info)} href={providerHref(key, info, d.kindFilter)} />;
          })}
        </ProviderSection>
      )}
      {d.apikeyVisible.length > 0 && (
        <ProviderSection title={translate("API Key Providers")} testMode="apikey" testLabel="Test all API Key connections" testAriaLabel="Test all API Key connections" testingMode={d.testingMode} onTest={d.handleBatchTest}
          footer={!d.isApikeySearching && !d.showAllApikey && d.hiddenApikeyCount > 0 ? (
            <Button variant="outline" onClick={() => d.setShowAllApikey(true)} className="w-full border-dashed border-primary/40 text-primary hover:border-primary hover:bg-primary/5">
              <ChevronDown className="size-4" />{translate("Show all")} {d.apikeyEntries.length} {translate("providers")}
            </Button>
          ) : undefined}
        >
          {d.filterEntries(d.visibleApikeyEntries, "other", "apikey").map(([key, info]) => (
            key === TYPESAFE_PROVIDER.id ? <TypesafeProviderCard key={key} hasKey={hasTypesafeKey} /> :
              <ApiKeyProviderCard key={key} providerId={key} provider={info} stats={d.getStats(key, "apikey")} onToggle={(active) => d.handleToggleProvider(key, "apikey", active)} availability={d.availabilityFor(info)} href={providerHref(key, info, d.kindFilter)} />
          ))}
        </ProviderSection>
      )}
      {d.retiredEntries.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="retired-providers-title">
          <div className="flex flex-col gap-1">
            <h2 id="retired-providers-title" className="text-lg sm:text-xl font-semibold leading-tight">{translate("Deprecated providers")}</h2>
            <p className="text-xs text-text-muted">{translate("These providers failed the automated test battery repeatedly or their service is gone. Existing connections keep working, but new ones are not recommended.")}</p>
          </div>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {d.retiredEntries.map(([key, info]) => (
              <li key={key} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <Link href={providerHref(key, info, d.kindFilter)} className="font-medium text-text-main hover:underline underline-offset-4">{info.name}</Link>
                <span className="text-xs text-text-muted">{info.retired?.reason} · {translate("since")} {info.retired?.since}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Modals showAddCompatibleModal={d.showAddCompatibleModal} onCloseAddCompatible={() => d.setShowAddCompatibleModal(false)} showAddAnthropicCompatibleModal={d.showAddAnthropicCompatibleModal} onCloseAddAnthropicCompatible={() => d.setShowAddAnthropicCompatibleModal(false)} onNodeCreated={(node: ProviderNode) => { d.setProviderNodes((prev) => [...prev, node]); }} testResults={d.testResults} onCloseTestResults={() => d.setTestResults(null)} />
    </div>
  );
}
