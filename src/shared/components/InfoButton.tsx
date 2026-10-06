"use client";

import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import Modal from "@/shared/components/Modal";
import { translate } from "@/i18n/runtime";

/**
 * An "i" that keeps long explanatory copy off the screen: a click opens the text
 * in a modal. `label` names the topic and is what screen readers hear.
 */
export function InfoButton({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${translate("About") || "About"} ${label}`}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-black/5 hover:text-text-main focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:hover:bg-white/10"
      >
        <Info className="size-4" aria-hidden />
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title={title ?? label} size="md">
        <div className="flex flex-col gap-3 text-sm text-text-muted">{children}</div>
      </Modal>
    </>
  );
}
