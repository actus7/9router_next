"use client";

import { Brain } from "lucide-react";
import { translate } from "@/i18n/runtime";
import CollapsibleSection from "./CollapsibleSection";

interface Props {
  thinking?: string;
  content?: string;
}

export default function ClientResponsePanel({ thinking, content }: Props) {
  return (
    <CollapsibleSection
      title={translate("4. Client Response (Final)") || "4. Client Response (Final)"}
      defaultOpen={true}
      icon="output"
    >
      {thinking && (
        <div className="mb-4">
          <h4 className="font-semibold text-text-main mb-2 flex items-center gap-2 text-xs uppercase tracking-wide opacity-70">
            <Brain className="size-4" />
            {translate("Thinking Process")}
          </h4>
          <pre className="max-h-[200px] max-w-full overflow-auto rounded-lg border border-warning-border bg-warning p-3 font-mono text-xs text-warning-foreground dark:border-warning-border dark:bg-warning dark:text-warning-foreground sm:p-4">
            {thinking}
          </pre>
        </div>
      )}

      <h4 className="font-semibold text-text-main mb-2 text-xs uppercase tracking-wide opacity-70">
        {translate("Content")}
      </h4>
      <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
        {content || translate("[No content]")}
      </pre>
    </CollapsibleSection>
  );
}
