"use client";

import { translate } from "@/i18n/runtime";
import CollapsibleSection from "./CollapsibleSection";

interface Props {
  title: string;
  data: unknown;
  defaultOpen?: boolean;
  icon?: string | null;
}

interface TruncatedBody {
  _truncated: true;
  _originalSize?: number;
  _preview?: string;
}

// Large bodies are stored as `{ _truncated, _originalSize, _preview }`; printed
// as JSON that reads like a strange payload instead of "this was cut".
function isTruncated(data: unknown): data is TruncatedBody {
  return typeof data === "object" && data !== null && (data as Record<string, unknown>)._truncated === true;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 ? `${Math.round(bytes / 1024).toLocaleString()} KB` : `${bytes} B`;
}

const PRE = "max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4";
const TRUNCATED_NOTE = "Body too large to store in full; showing its beginning.";

export default function JsonCollapsiblePanel({ title, data, defaultOpen = false, icon = null }: Props) {
  if (data === undefined || data === null) return null;

  return (
    <CollapsibleSection title={title} defaultOpen={defaultOpen} icon={icon}>
      {isTruncated(data) ? (
        <>
          <p className="mb-2 text-xs text-text-muted">
            {translate(TRUNCATED_NOTE) || TRUNCATED_NOTE}
            {data._originalSize ? ` (${formatSize(data._originalSize)})` : ""}
          </p>
          <pre className={`${PRE} whitespace-pre-wrap break-all`}>{data._preview || ""}…</pre>
        </>
      ) : (
        <pre className={PRE}>{typeof data === "object" ? JSON.stringify(data, null, 2) : String(data)}</pre>
      )}
    </CollapsibleSection>
  );
}
