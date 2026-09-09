"use client";

import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { translate } from "@/i18n/runtime";

interface Props {
  providers: Array<{ id: string; name: string }>;
  filters: { provider: string; startDate: string; endDate: string };
  onFiltersChange: (filters: { provider: string; startDate: string; endDate: string }) => void;
}

export default function FilterBar({ providers, filters, onFiltersChange }: Props) {
  const handleClearFilters = () => {
    onFiltersChange({ provider: "", startDate: "", endDate: "" });
  };

  return (
    <Card padding="md">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="provider-filter" className="text-text-main">{translate("Provider")}</Label>
          <Select
            value={filters.provider || "__all__"}
            onValueChange={(val) => onFiltersChange({ ...filters, provider: val === "__all__" ? "" : (val ?? "") })}
          >
            <SelectTrigger id="provider-filter" className="w-full h-9">
              <SelectValue placeholder={translate("All Providers")}>
                {(val) => val === "__all__" ? translate("All Providers") : (providers.find((p) => p.id === val)?.name || val)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{translate("All Providers")}</SelectItem>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="start-date-filter" className="text-text-main">{translate("Start Date")}</Label>
          <Input id="start-date-filter" type="datetime-local" value={filters.startDate}
            onChange={(e) => onFiltersChange({ ...filters, startDate: e.target.value })}
            className="h-9 px-3 w-full min-w-0 text-sm text-text-main" />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="end-date-filter" className="text-text-main">{translate("End Date")}</Label>
          <Input id="end-date-filter" type="datetime-local" value={filters.endDate}
            onChange={(e) => onFiltersChange({ ...filters, endDate: e.target.value })}
            className="h-9 px-3 w-full min-w-0 text-sm text-text-main" />
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:col-span-2 lg:col-span-1">
          {/*
            * Spacer, not content: it reserves the height of a <Label> so the button
            * lines up with the fields above on lg. It used to hold the word "Clear",
            * which pt-BR translates (Limpar) — so the i18n DOM walker rewrote this
            * node after render and lost the race with hydration. A non-breaking
            * space cannot be translated: `processTextNode` skips any node whose
            * text is whitespace, and String.trim() counts U+00A0 as whitespace.
            */}
          <span className="hidden text-sm font-medium text-text-main opacity-0 lg:block" aria-hidden="true">&nbsp;</span>
          <Button variant="ghost" onClick={handleClearFilters}
            disabled={!filters.provider && !filters.startDate && !filters.endDate} className="w-full">
            {translate("Clear Filters")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
