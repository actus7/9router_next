"use client";

import { useState } from "react";
import { FormInput as Input } from "@/shared/components/FormInput";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { useDecisionEngine } from "../hooks/useDecisionEngine";

const t = (text: string): string => translate(text) ?? text;

// Vercel's own team-agnostic link (from its API-keys docs): `[team]` resolves
// to whichever team the visitor is signed into. Same URL as the provider card.
const GATEWAY_KEY_URL = "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keys";
const TYPESAFE_KEY_URL = "https://console.typesafe.ai/keys";

type Source = "typesafe" | "gateway";
type Engine = ReturnType<typeof useDecisionEngine>;

/**
 * Where Jev's credential comes from. A key issued by TypeSafe itself goes
 * straight to TypeSafe and wins; otherwise the account's Vercel AI Gateway
 * connection. Both are saved on the account, encrypted, from here.
 */
export default function JevKeySection({ engine, children }: { engine: Engine; children: React.ReactNode }) {
  const [source, setSource] = useState<Source>("typesafe");
  const [apiKey, setApiKey] = useState("");

  if (engine.hasTypesafeKey) {
    return (
      <KeyInUse text={t("Using your TypeSafe key. Jev is called directly at TypeSafe.")} engine={engine}>
        <Button variant="ghost" size="sm" onClick={() => engine.removeTypesafeKey()}>{t("Remove key")}</Button>
        {children}
      </KeyInUse>
    );
  }
  if (engine.hasGatewayKey) {
    return <KeyInUse text={t("Using the key of your Vercel AI Gateway connection.")} engine={engine}>{children}</KeyInUse>;
  }
  if (engine.hasGatewayKey === null && engine.hasTypesafeKey === null) return null;

  const isTypesafe = source === "typesafe";
  const submit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = isTypesafe ? await engine.connectTypesafeKey(apiKey) : await engine.connectGatewayKey(apiKey);
    if (saved) setApiKey("");
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={t("Jev key")} className="grid grid-cols-2 gap-2">
        {(["typesafe", "gateway"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            role="radio"
            aria-checked={source === value}
            variant={source === value ? "primary" : "outline"}
            size="sm"
            onClick={() => { setSource(value); setApiKey(""); }}
          >
            {value === "typesafe" ? t("TypeSafe key") : "Vercel AI Gateway"}
          </Button>
        ))}
      </div>
      <p className="text-sm">
        {isTypesafe
          ? t("Paste a Jev API key created at TypeSafe. It is tested with one call before being saved, encrypted, to this account.")
          : t("Jev needs a Vercel AI Gateway API key. Create one in AI Gateway → API Keys, then paste it here. It is saved encrypted to this account and also enables the gateway's models.")}
      </p>
      <a
        href={isTypesafe ? TYPESAFE_KEY_URL : GATEWAY_KEY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline w-fit"
      >
        {isTypesafe ? t("Create key on TypeSafe") : t("Create key on Vercel")}
        <ExternalLink className="size-3.5" />
      </a>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          type="password"
          autoComplete="off"
          placeholder={isTypesafe ? "••••••••" : "vck_…"}
          aria-label={isTypesafe ? t("TypeSafe API key") : t("Vercel AI Gateway API key")}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          disabled={engine.connecting}
        />
        <Button type="submit" variant="primary" loading={engine.connecting} disabled={!apiKey.trim()}>
          {t("Save key")}
        </Button>
      </div>
      {engine.error && <p className="text-sm text-destructive">{t(engine.error)}</p>}
    </form>
  );
}

function KeyInUse({ text, engine, children }: { text: string; engine: Engine; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="size-4 text-success shrink-0" />
          {text}
        </p>
        <Button variant="outline" size="sm" loading={engine.testing} onClick={() => engine.testJev()}>
          {t("Test Jev")}
        </Button>
      </div>
      {children}
    </div>
  );
}
