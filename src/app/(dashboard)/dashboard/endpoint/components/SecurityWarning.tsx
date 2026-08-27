"use client";

import { TriangleAlert } from "lucide-react";

interface SecurityAction {
  label: string;
  href: string;
}

interface SecurityWarningProps {
  message: string;
  action?: SecurityAction;
}

/** Security warning banner with optional action link */
export default function SecurityWarning({ message, action }: SecurityWarningProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400">
      <TriangleAlert className="size-4" />
      <p className="text-xs flex-1">{message}</p>
      {action && (
        <a
          href={action.href}
          className="text-xs font-medium underline shrink-0 hover:opacity-80"
          onClick={action.href.startsWith("#") ? (e: React.MouseEvent<HTMLAnchorElement>) => {
            e.preventDefault();
            document.getElementById(action.href.slice(1))?.scrollIntoView({ behavior: "smooth" });
          } : undefined}
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
