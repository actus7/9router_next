"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface PxpipeSectionProps {
  pxpipeEnabled: boolean;
  pxpipeStatus: { installed: boolean };
  pxpipeStatusLabel: string;
  pxpipeChipClass: string;
  setShowPxpipeModal: (v: boolean) => void;
  handlePxpipeEnabled: (v: boolean) => void;
}

export default function PxpipeSection({
  pxpipeEnabled, pxpipeStatus, pxpipeStatusLabel, pxpipeChipClass,
  setShowPxpipeModal, handlePxpipeEnabled,
}: PxpipeSectionProps) {
  return (
    /* PXPIPE hidden from UI — experimental, not exposed to users yet */
    <>{false && (
      <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="font-medium">
              Compress prompts as images{" "}
              <a
                href="https://github.com/teamchong/pxpipe"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (PXPIPE)
              </a>
            </p>
            <span className={`text-xs px-2 py-0.5 rounded ${pxpipeChipClass}`}>
              {pxpipeStatusLabel}
            </span>
            <Button
              variant="link"
              size="sm"
              onClick={() => setShowPxpipeModal(true)}
              className="h-auto p-0 text-xs"
            >
              {pxpipeStatus.installed ? "Manage" : "Setup"}
            </Button>
            <a
              href="/dashboard/pxpipe"
              className="text-xs text-primary underline hover:opacity-80"
            >
              Dashboard
            </a>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Transforms large textual context into optimized images before
            sending to the LLM. Ideal for huge prompts, tool outputs and long
            conversations.
          </p>
        </div>
        <Switch
          checked={pxpipeEnabled}
          disabled={!pxpipeStatus.installed}
          onCheckedChange={() => handlePxpipeEnabled(!pxpipeEnabled)}
        />
      </div>
    )}</>
  );
}
