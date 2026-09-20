"use client";

import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";

import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import { ACCOUNT_PATH } from "@/lib/auth/paths";
import { translate } from "@/i18n/runtime";

/**
 * Account security now lives with the identity provider.
 *
 * The password used to be a bcrypt hash in this app's `settings` row, so this
 * card owned a change-password form. Neon Auth holds the credential today —
 * along with the sessions and the connected sign-in providers — and it is the
 * only thing that can change any of them, so this card points at it instead of
 * reimplementing a form that could only go out of date.
 */
export default function SecurityCard() {
  const router = useRouter();

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="size-10 rounded-lg bg-warning text-warning-foreground flex items-center justify-center shrink-0">
          <KeyRound className="size-5" />
        </div>
        <h3 className="text-base sm:text-lg font-semibold">{translate("Security")}</h3>
      </div>
      <Button
        variant="outline"
        onClick={() => router.push(ACCOUNT_PATH)}
        className="flex items-center justify-between w-full p-3 rounded-lg bg-bg border border-border hover:border-primary/50 transition-colors"
      >
        <span className="text-sm text-text-muted">
          {translate("Password, sign-in providers and active sessions")}
        </span>
        <span className="text-sm text-primary">{translate("Manage account")}</span>
      </Button>
    </Card>
  );
}
