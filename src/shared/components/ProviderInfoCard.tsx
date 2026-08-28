"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface FieldSchema {
  label: string;
  format: (v: unknown) => string;
  mono?: boolean;
  isLink?: boolean;
}

// Only show fields user actually cares about
const FIELD_SCHEMA: Record<string, FieldSchema> = {
  mode:             { label: translate("Mode") ?? "Mode",       format: (v) => String(v) },
  defaultModel:     { label: translate("Model") ?? "Model",      format: (v) => String(v), mono: true },
  baseUrl:          { label: translate("Endpoint") ?? "Endpoint",   format: (v) => String(v), isLink: true, mono: true },
  costPerQuery:     { label: translate("Cost per call") ?? "Cost per call", format: (v) => v === 0 ? (translate("Free") ?? "Free") : `$${(v as number).toFixed(4)}` },
  pricingUrl:       { label: translate("Pricing") ?? "Pricing",    format: () => translate("View pricing") ?? "View pricing", isLink: true },
  freeTier:         { label: translate("Free tier") ?? "Free tier",  format: (v) => String(v) },
  freeMonthlyQuota: { label: translate("Free quota") ?? "Free quota",  format: (v) => v === 0 ? "—" : (v as number) >= 999999 ? (translate("Unlimited") ?? "Unlimited") : `${(v as number).toLocaleString()} / ${translate("month") ?? "month"}` },
  searchTypes:      { label: translate("Types") ?? "Types",      format: (v) => (v as string[]).join(", ") },
  formats:          { label: translate("Formats") ?? "Formats",    format: (v) => (v as string[]).join(", ") },
  maxMaxResults:    { label: translate("Max results") ?? "Max results", format: (v) => String(v) },
  maxCharacters:    { label: translate("Max characters") ?? "Max characters",  format: (v) => (v as number).toLocaleString() },
};

interface ProviderNotice {
  apiKeyUrl?: string;
  text?: string;
}

interface Provider {
  notice?: ProviderNotice;
  website?: string;
}

interface ProviderInfoCardProps {
  config: Record<string, unknown> | null;
  provider?: Provider;
  title?: string;
}

export default function ProviderInfoCard({ config, provider, title = translate("Provider Information") ?? "Provider Information" }: ProviderInfoCardProps) {
  if (!config) return null;

  const rows = Object.entries(FIELD_SCHEMA)
    .filter(([key]) => config[key] !== undefined && config[key] !== null && config[key] !== "")
    .map(([key, schema]) => ({
      key,
      label: schema.label,
      value: schema.format(config[key]),
      isLink: schema.isLink,
      mono: schema.mono,
      raw: config[key],
    }));

  const signupUrl = provider?.notice?.apiKeyUrl || provider?.website;
  const noticeText = provider?.notice?.text;

  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          {signupUrl && (
            <a
              href={signupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink className="size-4" />
              {translate("Get API Key")}
            </a>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-3 min-w-0">
              <span className="text-xs text-text-muted w-28 shrink-0">{r.label}</span>
              {r.isLink ? (
                <a
                  href={r.raw as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`text-sm text-primary hover:underline truncate ${r.mono ? "font-mono" : ""}`}
                >
                  {r.value}
                </a>
              ) : (
                <span className={`text-sm text-text-main truncate ${r.mono ? "font-mono" : ""}`}>
                  {r.value}
                </span>
              )}
            </div>
          ))}
          {noticeText && (
            <div className="flex items-start gap-3 min-w-0 sm:col-span-2">
              <span className="text-xs text-text-muted w-28 shrink-0 mt-0.5">{translate("Notice")}</span>
              <span className="text-sm text-text-main leading-relaxed">{noticeText}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
