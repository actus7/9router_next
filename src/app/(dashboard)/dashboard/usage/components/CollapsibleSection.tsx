"use client";

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ArrowLeftFromLine, ArrowRightToLine, ChevronRight, Code2, Languages } from "lucide-react";

const iconMap: Record<string, React.ElementType> = {
  input: ArrowRightToLine,
  translate: Languages,
  data_object: Code2,
  output: ArrowLeftFromLine,
};

export default function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  icon = null,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  icon?: string | null;
}) {
  const IconComp = icon ? (iconMap[icon] || Code2) : null;

  return (
    <Collapsible defaultOpen={defaultOpen} className="border border-black/5 dark:border-white/5 rounded-lg overflow-hidden">
      <CollapsibleTrigger
        className="w-full flex items-center justify-between p-3 bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {IconComp && <span className="text-text-muted"><IconComp className="size-[18px]" /></span>}
          <span className="font-semibold text-sm text-text-main">{title}</span>
        </div>
        <ChevronRight className="size-5 text-text-muted transition-transform duration-200 [[data-open]>&]:rotate-90" />
      </CollapsibleTrigger>

      <CollapsibleContent className="p-4 border-t border-black/5 dark:border-white/5">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
