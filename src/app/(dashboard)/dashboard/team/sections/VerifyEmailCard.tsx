"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";

import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { translate } from "@/i18n/runtime";

const t = (text: string): string => translate(text) || text;

interface Props {
  email: string;
  onVerified: () => Promise<unknown>;
}

/**
 * Invitations are only shown to an account that proved it owns its address
 * (Neon Auth refuses otherwise), so an unverified account learns that here and
 * can verify without leaving the page: a one-time code by email, typed back.
 */
export default function VerifyEmailCard({ email, onVerified }: Props) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () => run(async () => {
    const { error: failure } = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
    if (failure) throw new Error(failure.message || t("Could not send the code."));
    setSent(true);
  });

  const verify = () => run(async () => {
    const { error: failure } = await authClient.emailOtp.verifyEmail({ email, otp: code.trim() });
    if (failure) throw new Error(failure.message || t("That code did not work. Check it or send a new one."));
    await onVerified();
  });

  return (
    <Card title={t("Got an invitation?")} subtitle={`${t("Confirm your email to see invitations sent to")} ${email}.`} icon={<MailCheck className="size-5" />}>
      {!sent ? (
        <Button variant="outline" onClick={() => void sendCode()} disabled={busy}>
          {busy ? t("Sending...") : t("Send me a code")}
        </Button>
      ) : (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.trim()) void verify();
          }}
        >
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={t("Code from the email")}
            aria-label={t("Verification code")}
            className="sm:max-w-48"
          />
          <Button type="submit" disabled={busy || !code.trim()}>{busy ? t("Checking...") : t("Confirm email")}</Button>
          <Button type="button" variant="ghost" onClick={() => void sendCode()} disabled={busy}>{t("Send a new code")}</Button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </Card>
  );
}
