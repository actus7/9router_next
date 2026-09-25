"use client";

import type { LucideIcon } from "lucide-react";
import { Brush, FileImage, Minimize2, Scissors, Shrink, Zap } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { TokenSaverId } from "@/shared/chat/tokenSavers";

type SaverStyle = { label: string; description: string; icon: LucideIcon; tone: string };

// One hue per saver so a glance tells them apart; each tone pairs a tinted
// surface with a text color that holds contrast in both themes.
const SAVERS: Record<TokenSaverId, SaverStyle> = {
  synapse: {
    label: "Synapse",
    description: "Answered locally by Synapse, without calling the model.",
    icon: Zap,
    tone: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  rtk: {
    label: "RTK",
    description: "RTK compressed tool output before sending it to the model.",
    icon: Scissors,
    tone: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  headroom: {
    label: "Headroom",
    description: "Headroom compressed the conversation context.",
    icon: Shrink,
    tone: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  caveman: {
    label: "Caveman",
    description: "Caveman asked the model for a terse answer.",
    icon: Minimize2,
    tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  ponytail: {
    label: "Ponytail",
    description: "Ponytail asked the model for the simplest solution.",
    icon: Brush,
    tone: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  pxpipe: {
    label: "PXPIPE",
    description: "PXPIPE sent bulky context as images to save tokens.",
    icon: FileImage,
    tone: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
};

/** One colored pill per token saver that acted on this answer. */
export default function TokenSaverPills({ savers }: { savers: readonly TokenSaverId[] }) {
  if (!savers.length) return null;
  return (
    <ul aria-label={translate("Token savers") || "Token savers"} className="mt-3 flex flex-wrap gap-1.5">
      {savers.map((id) => {
        const saver = SAVERS[id];
        const Icon = saver.icon;
        const description = translate(saver.description) || saver.description;
        return (
          <li
            key={id}
            title={description}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${saver.tone}`}
          >
            <Icon className="size-3" aria-hidden />
            {saver.label}
            <span className="sr-only">: {description}</span>
          </li>
        );
      })}
    </ul>
  );
}
