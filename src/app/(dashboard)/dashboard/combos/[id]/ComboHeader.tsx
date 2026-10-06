"use client";

import Link from "next/link";
import { ArrowLeft, BrainCircuit, Tag } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormInput as Input } from "@/shared/components/FormInput";
import { InfoButton } from "@/shared/components/InfoButton";
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

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BrainCircuit />
          </div>
          <h1 className="flex min-w-0 items-center gap-1.5 text-xl font-semibold text-text-main">
            <span className="truncate">{translate("Smart routing")}</span>
            <InfoButton label={translate("Smart routing") || "Smart routing"}>
              <p>{translate("Automatically selects the best model for each request, and uses fallback models if the primary fails.")}</p>
            </InfoButton>
          </h1>
        </div>

        <Card size="sm" className="gap-2 py-3">
          <CardHeader className="gap-0">
            <CardTitle className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
              <Tag className="size-3.5" aria-hidden />
              {translate("General information")}
              <InfoButton label={translate("Combo Name") || "Combo Name"}>
                <p>
                  {translate("Use this name in the")} <code className="font-mono">model</code>{" "}
                  {translate("field. The")} <code className="font-mono">x-router-tier</code>{" "}
                  {translate("header can pin a tier per request.")}
                </p>
              </InfoButton>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              label={translate("Combo Name") || "Combo Name"}
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
