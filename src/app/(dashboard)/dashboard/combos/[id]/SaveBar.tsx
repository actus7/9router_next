"use client";

import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";

/**
 * The one Save on the page, pinned so it is reachable from any card.
 *
 * Every card here edits local state and nothing persists until this runs. With
 * Save at the top of a long page, the button scrolled away from the edits it
 * was going to commit, and there was no sign that anything was pending.
 */
export function SaveBar({ dirty, saving, onSave }: { dirty: boolean; saving: boolean; onSave: () => void }) {
  return (
    // ponytail: o scroller do DashboardLayout tem p-6/lg:p-10; o bottom negativo (e -mb) cancela esse padding
    // para a barra colar no rodapé real em vez de flutuar com conteúdo passando por baixo.
    <div className="sticky -bottom-6 z-10 -mb-6 mt-6 flex flex-col gap-3 border-t border-border-subtle bg-surface px-6 py-3 lg:-bottom-10 lg:-mb-10 lg:px-10 sm:flex-row sm:items-center sm:justify-end">
      <p aria-live="polite" className="text-sm text-text-muted sm:mr-auto">
        {dirty
          ? translate("Unsaved changes") || "Unsaved changes"
          : translate("Everything saved") || "Everything saved"}
      </p>
      <Button onClick={onSave} loading={saving} disabled={!dirty} size="lg" className="min-h-11 w-full sm:min-h-9 sm:w-auto">
        <Save data-icon="inline-start" /> {translate("Save")}
      </Button>
    </div>
  );
}
