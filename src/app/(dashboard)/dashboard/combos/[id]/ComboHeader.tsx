"use client";

import Link from "next/link";
import { ArrowLeft, BrainCircuit } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { FormInput as Input } from "@/shared/components/FormInput";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

/**
 * Identity of the combo: what it is, and the name callers type in `model`.
 *
 * The name used to sit in a card of its own further down, which put the field
 * you need to copy below three screens of routing configuration. Saving moved
 * to the bar pinned at the bottom, so there is one Save on the page instead of
 * one at the top and edits happening below it.
 */
export function ComboHeader({ name, onNameChange }: { name: string; onNameChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/combos" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 w-fit")}>
        <ArrowLeft /> {translate("Back to combos")}
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BrainCircuit />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-text-main">{translate("Smart routing")}</h1>
            <p className="mt-0.5 text-sm text-text-muted">
              {translate("Automatically selects the best model for each request, and uses fallback models if the primary fails.")}
            </p>
          </div>
        </div>

        <div className="w-full lg:max-w-xs">
          <Input
            label={translate("Combo Name") || "Combo Name"}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <p className="mt-1.5 text-xs text-text-muted">
            {translate("Use this name in the")} <code className="font-mono">model</code>{" "}
            {translate("field. The")} <code className="font-mono">x-router-tier</code>{" "}
            {translate("header can pin a tier per request.")}
          </p>
        </div>
      </div>
    </div>
  );
}
