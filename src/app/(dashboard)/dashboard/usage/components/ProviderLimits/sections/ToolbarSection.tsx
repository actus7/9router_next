"use client";

import ProviderIcon from "@/shared/components/ProviderIcon";
import Button from "@/shared/components/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  shouldResetPage,
  ACCOUNT_FILTER_OPTIONS,
  QUOTA_SORT_OPTIONS,
} from "../utils";
import { translate } from "@/i18n/runtime";
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  Hourglass,
  LayoutGrid,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

interface ToolbarSectionProps {
  providerFilter: string;
  setProviderFilter: React.Dispatch<React.SetStateAction<string>>;
  providerMenuOpen: boolean;
  setProviderMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  providerOptions: string[];
  selectedProviderLabel: string;
  accountFilter: string;
  setAccountFilter: React.Dispatch<React.SetStateAction<string>>;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  quotaSortMode: string;
  setQuotaSortMode: React.Dispatch<React.SetStateAction<string>>;
  expiringFirst: boolean;
  setExpiringFirst: React.Dispatch<React.SetStateAction<boolean>>;
  handleDisableDepleted: () => void;
  handleEnableAvailable: () => void;
  bulkToggling: boolean;
  autoRefresh: boolean;
  setAutoRefresh: React.Dispatch<React.SetStateAction<boolean>>;
  countdown: number;
  refreshAll: (force?: boolean) => Promise<void>;
  refreshingAll: boolean;
}

export default function ToolbarSection({
  providerFilter,
  setProviderFilter,
  providerMenuOpen,
  setProviderMenuOpen,
  providerOptions,
  selectedProviderLabel,
  accountFilter,
  setAccountFilter,
  setPage,
  quotaSortMode,
  setQuotaSortMode,
  expiringFirst,
  setExpiringFirst,
  handleDisableDepleted,
  handleEnableAvailable,
  bulkToggling,
  autoRefresh,
  setAutoRefresh,
  countdown,
  refreshAll,
  refreshingAll,
}: ToolbarSectionProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => setProviderMenuOpen((prev) => !prev)}
            className="gap-1 text-xs"
            aria-haspopup="menu"
            aria-expanded={providerMenuOpen}
            title="Filter quota providers"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {providerFilter === "all" ? (
                <LayoutGrid className="size-3.5 text-text-muted" />
              ) : (
                <ProviderIcon
                  src={`/providers/${providerFilter}.png`}
                  alt={providerFilter}
                  size={18}
                  className="size-[18px] rounded object-contain"
                  fallbackText={providerFilter.slice(0, 2).toUpperCase()}
                />
              )}
              <span className="truncate capitalize hidden lg:inline">
                {selectedProviderLabel}
              </span>
            </span>
            <ChevronDown className="size-4" />
          </Button>

          {providerMenuOpen && (
            <>
              <Button
                type="button"
                variant="ghost"
                className="fixed inset-0 z-30 bg-transparent"
                aria-label="Close provider filter"
                onClick={() => setProviderMenuOpen(false)}
              />
              <div className="absolute left-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-black/10 bg-surface/95 p-1.5 shadow-xl shadow-black/10 backdrop-blur dark:border-white/10 dark:bg-surface/95 sm:w-72">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (shouldResetPage(providerFilter, "all")) {
                      setPage(1);
                    }
                    setProviderFilter("all");
                    setProviderMenuOpen(false);
                  }}
                  className={`w-full justify-start gap-3 rounded-xl px-3 py-2.5 ${providerFilter === "all" ? "bg-primary/10 text-primary" : ""}`}
                >
                  <LayoutGrid className="size-5" />
                  <span className="font-medium">{translate("All providers") || "All providers"}</span>
                  {providerFilter === "all" && (
                    <Check className="size-5" />
                  )}
                </Button>
                <div className="my-1 h-px bg-black/10 dark:bg-white/10" />
                <div className="max-h-72 overflow-y-auto pr-1">
                  {providerOptions.map((provider) => (
                    <Button
                      key={provider}
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        if (shouldResetPage(providerFilter, provider)) {
                          setPage(1);
                        }
                        setProviderFilter(provider);
                        setProviderMenuOpen(false);
                      }}
                      className={`w-full justify-start gap-3 rounded-xl px-3 py-2.5 ${providerFilter === provider ? "bg-primary/10 text-primary" : ""}`}
                    >
                      <ProviderIcon
                        src={`/providers/${provider}.png`}
                        alt={provider}
                        size={24}
                        className="size-6 rounded-md object-contain"
                        fallbackText={provider.slice(0, 2).toUpperCase()}
                      />
                      <span className="font-medium capitalize">
                        {provider}
                      </span>
                      {providerFilter === provider && (
                        <Check className="size-5" />
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <Select
          value={accountFilter}
          onValueChange={(nextValue) => {
            if (nextValue === null) return;
            if (shouldResetPage(accountFilter, nextValue)) {
              setPage(1);
            }
            setAccountFilter(nextValue);
          }}
        >
          <SelectTrigger className="h-8 text-xs" aria-label="Filter accounts by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACCOUNT_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {providerFilter === "codex" && (
          <Select
            value={quotaSortMode}
            onValueChange={(value) => { if (value !== null) setQuotaSortMode(value); }}
          >
            <SelectTrigger className="h-8 text-xs" aria-label="Sort Codex quotas by remaining">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUOTA_SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={() => setExpiringFirst((prev) => !prev)}
          aria-pressed={expiringFirst}
          className={`gap-1 text-xs ${expiringFirst ? "border-amber-500/40 bg-amber-500/10 text-amber-500" : ""}`}
          title="Sort accounts by earliest quota reset time"
        >
          <Hourglass className="size-3.5" />
          <span className="hidden sm:inline">{translate("Expiring first") || "Expiring first"}</span>
        </Button>

        {/* Bulk: disable depleted */}
        <Button
          type="button"
          variant="destructive"
          onClick={handleDisableDepleted}
          disabled={bulkToggling}
          className="gap-1 text-xs"
          title="Disable connections with depleted quota on the current page"
        >
          <Ban className="size-4" />
          <span className="hidden sm:inline">{translate("Disable Depleted") || "Disable Depleted"}</span>
        </Button>

        {/* Bulk: enable available */}
        <Button
          type="button"
          variant="outline"
          onClick={handleEnableAvailable}
          disabled={bulkToggling}
          className="gap-1 text-xs border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
          title="Enable connections that still have quota on the current page"
        >
          <CheckCircle2 className="size-4" />
          <span className="hidden sm:inline">{translate("Activate Available") || "Activate Available"}</span>
        </Button>

        {/* Auto-refresh toggle */}
        <Button
          variant="outline"
          onClick={() => setAutoRefresh((prev) => !prev)}
          className="gap-1 text-xs"
          title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}
        >
          {autoRefresh ? (
            <ToggleRight className="size-3.5 text-primary" />
          ) : (
            <ToggleLeft className="size-3.5 text-text-muted" />
          )}
          <span className="hidden text-text-primary sm:inline">
            {translate("Auto-refresh") || "Auto-refresh"}
          </span>
          {autoRefresh && (
            <span className="text-[10px] text-text-muted tabular-nums">
              ({countdown}s)
            </span>
          )}
        </Button>


        {/* Refresh all button */}
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => refreshAll(true)}
          disabled={refreshingAll}
          title={translate("Refresh all") || "Refresh all"}
        >
          <RefreshCw className={`size-3.5 ${refreshingAll ? "animate-spin" : ""}`} />
        </Button>
      </div>
    </div>
  );
}
