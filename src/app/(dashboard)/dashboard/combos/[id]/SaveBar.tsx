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
    <div className="sticky bottom-0 z-10 -mx-1 mt-2 flex flex-col gap-3 border-t border-border-subtle bg-surface/95 px-1 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-end sm:px-0">
      <p aria-live="polite" className="text-sm text-text-muted sm:mr-auto">
        {dirty
          ? translate("Unsaved changes") || "Unsaved changes"
          : translate("Everything saved") || "Everything saved"}
      </p>
      <Button onClick={onSave} loading={saving} disabled={!dirty} size="lg" className="min-h-11 w-full sm:w-auto">
        <Save data-icon="inline-start" /> {translate("Save")}
      </Button>
    </div>
  );
}
