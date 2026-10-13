"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { translate } from "@/i18n/runtime";
import type { UsageLimits } from "@/shared/access/accessPolicy";

const t = (text: string): string => translate(text) || text;

interface Props {
  limits: UsageLimits | undefined;
  readOnly: boolean;
  onChange: (limits: UsageLimits | undefined) => void;
}

/** An empty field is "no limit", the same as the server reads it. */
function toNumber(raw: string): number | undefined {
  const value = Number(raw);
  return raw.trim() !== "" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * How much this subject may use. Counted against the subject alone: a
 * member's budget is what that member spent, whichever key they used.
 */
export default function AccessLimitsSection({ limits, readOnly, onChange }: Props) {
  // The text as typed, so "1." or an empty field survives a keystroke; the
  // policy only ever holds the number it parses to.
  const [text, setText] = useState({
    rpm: limits?.rpm?.toString() ?? "",
    monthlyBudgetUsd: limits?.monthlyBudgetUsd?.toString() ?? "",
  });
  const set = (field: keyof UsageLimits, raw: string) => {
    setText((current) => ({ ...current, [field]: raw }));
    const next: UsageLimits = { ...limits, [field]: toNumber(raw) };
    if (next[field] === undefined) delete next[field];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  return (
    <section aria-labelledby="access-limits" className="flex flex-col gap-3">
      <div>
        <h3 id="access-limits" className="text-sm font-semibold text-text-main">{t("Usage limits")}</h3>
        <p className="mt-0.5 text-xs text-text-muted">
          {t("Past a limit, requests are refused with a clear message until it resets. Leave empty for no limit.")}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="limit-rpm">{t("Requests per minute")}</Label>
          <Input
            id="limit-rpm"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder={t("No limit")}
            disabled={readOnly}
            value={text.rpm}
            onChange={(event) => set("rpm", event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="limit-budget">{t("Monthly budget (US$)")}</Label>
          <Input
            id="limit-budget"
            type="number"
            inputMode="decimal"
            min={0.01}
            step={0.01}
            placeholder={t("No limit")}
            disabled={readOnly}
            value={text.monthlyBudgetUsd}
            onChange={(event) => set("monthlyBudgetUsd", event.target.value)}
          />
          <p className="text-xs text-text-muted">{t("Resets on the 1st of each month (UTC), priced as in Usage.")}</p>
        </div>
      </div>
    </section>
  );
}
