"use client";

import Link from "next/link";
import { Cpu } from "lucide-react";
import Card from "@/shared/components/Card";
import { Badge } from "@/components/ui/badge";
import { translate } from "@/i18n/runtime";
import { TYPESAFE_PROVIDER, TYPESAFE_SETTINGS_HREF } from "../typesafeProvider";

export function TypesafeProviderCard({ hasKey }: { hasKey: boolean | null }) {
  return (
    <Link href={TYPESAFE_SETTINGS_HREF} className="group min-w-0">
      <Card padding="xs" className="h-full hover:bg-surface-2/30 transition-colors cursor-pointer">
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 shrink-0 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
            <Cpu className="size-5" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{TYPESAFE_PROVIDER.name}</h3>
            <div role="status" className="text-xs">
              {hasKey === null ? (
                <span className="text-destructive">{translate("Could not check the Jev key.")}</span>
              ) : hasKey ? (
                <Badge variant="success">{translate("Connected")}</Badge>
              ) : (
                <span className="text-text-muted">{translate("No connections")}</span>
              )}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
