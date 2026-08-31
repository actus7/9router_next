"use client";

import CollapsibleSection from "./CollapsibleSection";

interface Props {
  title: string;
  data: unknown;
  defaultOpen?: boolean;
  icon?: string | null;
}

export default function JsonCollapsiblePanel({ title, data, defaultOpen = false, icon = null }: Props) {
  if (data === undefined || data === null) return null;

  return (
    <CollapsibleSection title={title} defaultOpen={defaultOpen} icon={icon}>
      <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
        {typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data)}
      </pre>
    </CollapsibleSection>
  );
}
