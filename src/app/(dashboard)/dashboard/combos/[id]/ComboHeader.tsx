"use client";

import Link from "next/link";
import { ArrowLeft, BrainCircuit, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoButton } from "@/shared/components/InfoButton";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

/**
 * Identity of the combo in one row: back, what it is, the name callers type in
 * `model`, and the catalogue refresh. Saving stays in the bar pinned at the
 * bottom, so there is one Save on the page.
 */
export function ComboHeader({ name, onNameChange, onRefreshAllModels, refreshingModels }: {
  name: string;
  onNameChange: (value: string) => void;
  onRefreshAllModels: () => void;
  refreshingModels: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <Link
        href="/dashboard/combos"
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "-ml-2")}
        aria-label={translate("Back to combos") || "Back to combos"}
      >
        <ArrowLeft />
      </Link>
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <BrainCircuit className="size-5" />
        </div>
        <h1 className="flex items-center gap-1.5 text-lg font-semibold text-text-main">
          <span className="truncate">{translate("Smart routing")}</span>
          <InfoButton label={translate("Smart routing") || "Smart routing"}>
            <p>{translate("Automatically selects the best model for each request, and uses fallback models if the primary fails.")}</p>
          </InfoButton>
        </h1>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2 sm:min-w-64 sm:max-w-md">
        <Label htmlFor="combo-name" className="shrink-0 text-sm text-text-muted">{translate("Combo Name")}</Label>
        <Input id="combo-name" className="h-8" value={name} onChange={(event) => onNameChange(event.target.value)} />
        <InfoButton label={translate("Combo Name") || "Combo Name"}>
          <p>
            {translate("Use this name in the")} <code className="font-mono">model</code>{" "}
            {translate("field. The")} <code className="font-mono">x-router-tier</code>{" "}
            {translate("header can pin a tier per request.")}
          </p>
        </InfoButton>
      </div>

      <Button className="ml-auto shrink-0" size="sm" onClick={onRefreshAllModels} loading={refreshingModels}>
        <RefreshCw data-icon="inline-start" /> {translate("Update models from all providers")}
      </Button>
    </div>
  );
}
