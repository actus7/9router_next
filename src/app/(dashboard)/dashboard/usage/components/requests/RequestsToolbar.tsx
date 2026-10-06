"use client";

import { ArrowRightLeft, X } from "lucide-react";
import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import { getProviderName } from "../providerUtils";
import { MODELHUB_PROVIDER } from "@/shared/usage/requestFilters";
import type { RequestFilters, RequestsResponse } from "./types";

function t(text: string): string {
  return translate(text) || text;
}

interface Props {
  filters: RequestFilters;
  onChange: (patch: Partial<RequestFilters>) => void;
  filterOptions: RequestsResponse["filterOptions"];
  providerNameCache: Record<string, string | { name?: string }> | null;
  totalItems: number;
}

const STATUS_OPTIONS: Array<{ value: RequestFilters["status"]; label: string }> = [
  { value: "", label: "All" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
];

const RANGE_OPTIONS: Array<{ value: RequestFilters["range"]; label: string }> = [
  { value: "", label: "All" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "365d", label: "365d" },
];

const chipTone = (active: boolean, tone: "red" | "amber") =>
  cn(
    "h-8 gap-1.5 rounded-full px-3 text-xs",
    active && tone === "red" &&
      "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive",
    active && tone === "amber" &&
      "border-warning-border/30 bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning",
    !active && "text-text-muted",
  );

/** Filters above the requests list: status, model, provider, period and the
 *  two "how it routed" chips, with the running count on the right. */
export default function RequestsToolbar({ filters, onChange, filterOptions, providerNameCache, totalItems }: Props) {
  const models = filterOptions?.models ?? [];
  const providers = filterOptions?.providers ?? [];
  const apiKeys = filterOptions?.apiKeys ?? [];
  const keyLabel = (id: string) => apiKeys.find((k) => k.id === id)?.name || `${id.slice(0, 8)}…`;
  const providerLabel = (p: string) => (p === MODELHUB_PROVIDER ? "ModelHub" : getProviderName(p, providerNameCache));
  const allLabel = t("All");
  const statusLabel = (val: string) => STATUS_OPTIONS.find((o) => o.value === val)?.label ?? val;
  const rangeLabel = (val: string) => RANGE_OPTIONS.find((o) => o.value === val)?.label ?? val;

  return (
    <Card padding="md">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="requests-status" className="text-xs text-text-muted">{t("Status")}</Label>
          <Select value={filters.status || "__all__"} onValueChange={(val) => onChange({ status: (val && val !== "__all__" ? val : "") as RequestFilters["status"] })}>
            <SelectTrigger id="requests-status" className="h-8 w-32 text-xs">
              <SelectValue>{(val) => (val === "__all__" ? allLabel : t(statusLabel(val)))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{allLabel}</SelectItem>
              {STATUS_OPTIONS.filter((o) => o.value).map((o) => (
                <SelectItem key={o.value} value={o.value}>{t(o.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="requests-model" className="text-xs text-text-muted">{t("Model")}</Label>
          <Select value={filters.model || "__all__"} onValueChange={(val) => onChange({ model: val && val !== "__all__" ? val : "" })}>
            <SelectTrigger id="requests-model" className="h-8 w-52 text-xs">
              <SelectValue>{(val) => (val === "__all__" ? t("All models") : val)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("All models")}</SelectItem>
              {models.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="requests-provider" className="text-xs text-text-muted">{t("Provider")}</Label>
          <Select value={filters.provider || "__all__"} onValueChange={(val) => onChange({ provider: val && val !== "__all__" ? val : "" })}>
            <SelectTrigger id="requests-provider" className="h-8 w-44 text-xs">
              <SelectValue>
                {(val) => (val === "__all__" ? t("All providers") : providerLabel(val))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("All providers")}</SelectItem>
              <SelectItem value={MODELHUB_PROVIDER}>ModelHub</SelectItem>
              {providers.map((p) => (
                <SelectItem key={p} value={p}>{providerLabel(p)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="requests-api-key" className="text-xs text-text-muted">{t("API key")}</Label>
          <Select value={filters.apiKey || "__all__"} onValueChange={(val) => onChange({ apiKey: val && val !== "__all__" ? val : "" })}>
            <SelectTrigger id="requests-api-key" className="h-8 w-44 text-xs">
              <SelectValue>{(val) => (val === "__all__" ? t("All API keys") : keyLabel(val))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("All API keys")}</SelectItem>
              {apiKeys.map((k) => (
                <SelectItem key={k.id} value={k.id}>{keyLabel(k.id)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="requests-range" className="text-xs text-text-muted">{t("Period")}</Label>
          <Select value={filters.range || "__all__"} onValueChange={(val) => onChange({ range: (val && val !== "__all__" ? val : "") as RequestFilters["range"] })}>
            <SelectTrigger id="requests-range" className="h-8 w-28 text-xs">
              <SelectValue>{(val) => (val === "__all__" ? allLabel : rangeLabel(val))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{allLabel}</SelectItem>
              {RANGE_OPTIONS.filter((o) => o.value).map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            aria-pressed={filters.hasFailed}
            className={chipTone(filters.hasFailed, "red")}
            onClick={() => onChange({ hasFailed: !filters.hasFailed })}
          >
            <X className="size-3.5" aria-hidden />
            {t("With failed attempts")}
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-pressed={filters.fallback}
            className={chipTone(filters.fallback, "amber")}
            onClick={() => onChange({ fallback: !filters.fallback })}
          >
            <ArrowRightLeft className="size-3.5" aria-hidden />
            {t("With fallback")}
          </Button>
        </div>

        <p className="ml-auto pb-1.5 text-xs text-text-muted" aria-live="polite">
          {`${totalItems.toLocaleString()} ${t("requests")}`}
        </p>
      </div>
    </Card>
  );
}
