"use client";

import Link from "next/link";
import { ArrowLeft, BrainCircuit, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

export function ComboHeader({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <Link href="/dashboard/combos" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 mb-2")}>
          <ArrowLeft /> {translate("Back to combos")}
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><BrainCircuit /></div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-text-main">{translate("Smart routing")}</h1>
            <p className="mt-0.5 text-sm text-text-muted">{translate("Automatically selects the best model for each request, and uses fallback models if the primary fails.")}</p>
          </div>
        </div>
      </div>
      <Button onClick={onSave} loading={saving} size="lg" className="min-h-11 w-full sm:w-auto">
        <Save data-icon="inline-start" /> {translate("Save")}
      </Button>
    </div>
  );
}
