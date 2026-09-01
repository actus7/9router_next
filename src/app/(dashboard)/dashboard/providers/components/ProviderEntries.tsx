"use client";

import { translate } from "@/i18n/runtime";
import { getProviderConnectionAuthTypes } from "@/shared/constants/providers";
import { ProviderSection } from "./ProviderSection";
import { ProviderCard } from "./ProviderCard";
import { ApiKeyProviderCard } from "./ApiKeyProviderCard";
import type { ProviderInfo, ProviderStats, Availability } from "../types";

interface ProviderEntriesProps {
  entries: [string, ProviderInfo][];
  source: "free" | "freeTier" | "other";
  authTypes: string | string[];
  title: string;
  testMode: string;
  testLabel: string;
  testAriaLabel: string;
  testingMode: string | null;
  onTest: (mode: string) => void;
  getStats: (id: string, auth: string | string[]) => ProviderStats;
  onToggle: (id: string, auth: string | string[], active: boolean) => void;
  availabilityFor: (info: ProviderInfo) => Availability;
  filterEntries: (entries: [string, ProviderInfo][], source: "free" | "freeTier" | "other", authTypes: string | string[]) => [string, ProviderInfo][];
  useApiCard?: boolean;
  footer?: React.ReactNode;
}

export default function ProviderEntries({
  entries, source, authTypes, title, testMode, testLabel, testAriaLabel,
  testingMode, onTest, getStats, onToggle, availabilityFor, filterEntries,
  useApiCard = false, footer,
}: ProviderEntriesProps) {
  if (entries.length === 0) return null;
  const filtered = filterEntries(entries, source, authTypes);
  const Card = useApiCard ? ApiKeyProviderCard : ProviderCard;

  return (
    <ProviderSection title={title} testMode={testMode} testLabel={testLabel} testAriaLabel={testAriaLabel} testingMode={testingMode} onTest={onTest} footer={footer}>
      {filtered.map(([key, info]) => {
        const auth = typeof authTypes === "string" && authTypes === "auto" ? getProviderConnectionAuthTypes(info) : authTypes;
        return <Card key={key} providerId={key} provider={info} stats={getStats(key, auth)} onToggle={(active: boolean) => onToggle(key, auth, active)} availability={availabilityFor(info)} />;
      })}
    </ProviderSection>
  );
}
