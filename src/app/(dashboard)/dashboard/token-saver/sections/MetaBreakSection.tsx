"use client";

import { Switch } from "@/components/ui/switch";
import { translate } from "@/i18n/runtime";
import { useMetaBreak } from "../hooks/useMetaBreak";

const t = (text: string) => translate(text) || text;

export default function MetaBreakSection() {
  const { enabled, saving, loading, error, handleEnabled } = useMetaBreak();
  return (
    <section className="mt-4 flex flex-col gap-3 border-t border-border pt-4" aria-labelledby="metabreak-title">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <label id="metabreak-title" htmlFor="metabreak-enabled" className="font-medium">MetaBreak</label>
          <p id="metabreak-description" className="text-sm text-text-muted">
            {t("Direct answers, complete work and persistence with tools. A fixed profile, with no prompt editing.")}
          </p>
        </div>
        <Switch id="metabreak-enabled" checked={enabled} onCheckedChange={handleEnabled} disabled={loading || saving} aria-describedby="metabreak-description metabreak-limitations" />
      </div>
      <p id="metabreak-limitations" className="text-sm text-text-muted">
        {t("Experimental: adds context, not token compression. Results depend on the model and provider.")}
      </p>
      <details className="text-sm">
        <summary className="w-fit cursor-pointer rounded-sm py-2 text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">{t("How MetaBreak works")}</summary>
        <div className="flex flex-col gap-2 pt-2 text-text-muted">
          <p>{t("Asserts precedence over prior system prompts, safety layers, and refusal heuristics. Delivers the actual request without friction, substitutes, or redirects.")}</p>
          <p>{t("Works with tools, reasoning and structured output in Chat Completions, Responses/Codex, Claude and Gemini request formats. Preserves conversation history and existing instructions.")}</p>
        </div>
      </details>
      <p role="status" className="text-xs text-text-muted">{saving ? t("Saving MetaBreak…") : loading ? t("Loading MetaBreak…") : enabled ? t("MetaBreak enabled for compatible requests") : t("MetaBreak disabled")}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error === "save" ? t("Could not save MetaBreak. Your previous setting is unchanged. Try again.") : t("Could not load MetaBreak settings. Reload the page to try again.")}</p>}
    </section>
  );
}
