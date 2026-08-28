"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { marked } from "marked";
import { GITHUB_CONFIG } from "@/shared/constants/config";
import { Loader2 } from "lucide-react";
import { translate } from "@/i18n/runtime";

marked.setOptions({ gfm: true, breaks: true });

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChangelogModal({ isOpen, onClose }: ChangelogModalProps) {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!isOpen || html) return;
    setLoading(true);
    setError("");
    fetch(GITHUB_CONFIG.changelogUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((md) => setHtml(marked.parse(md) as string))
      .catch((err: Error) => setError(err.message || (translate("Failed to load") ?? "Failed to load")))
      .finally(() => setLoading(false));
  }, [isOpen, html]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p-0 gap-0 overflow-hidden sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogTitle className="sr-only">{translate("Change Log")}</DialogTitle>

        <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5">
          <h2 className="text-lg font-semibold text-text-main">{translate("Change Log")}</h2>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center py-10 text-text-muted">
              <Loader2 className="size-4" />
              {translate("Loading...")}
            </div>
          )}
          {error && (
            <div className="text-red-500 py-4">{translate("Failed to load changelog")}: {error}</div>
          )}
          {!loading && !error && html && (
            <div
              className="changelog-body text-text-main"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
