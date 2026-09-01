"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import type { TtsLanguage } from "./useTtsFormState";

interface TtsLanguageModalProps {
  setModalOpen: (open: boolean) => void;
  modalSearch: string;
  setModalSearch: (s: string) => void;
  modalLoading: boolean;
  modalError: string;
  filteredLanguages: TtsLanguage[];
  selectedLang: string;
  handlePickLanguage: (lang: TtsLanguage) => void;
}

export default function TtsLanguageModal({
  setModalOpen,
  modalSearch,
  setModalSearch,
  modalLoading,
  modalError,
  filteredLanguages,
  selectedLang,
  handlePickLanguage,
}: TtsLanguageModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }}
      onClick={() => setModalOpen(false)}
    >
      <div
        className="border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[80vh]"
        style={{ backgroundColor: "var(--color-bg)", isolation: "isolate" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 rounded-t-xl">
          <h3 className="text-sm font-semibold">Select Language</h3>
          <Button variant="ghost" size="icon" onClick={() => setModalOpen(false)} className="text-text-muted hover:text-primary">
            <X className="size-5" />
          </Button>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 border-b border-border shrink-0">
          <Input
            autoFocus
            value={modalSearch}
            onChange={(e) => setModalSearch(e.target.value)}
            placeholder="Search language..."
            className="w-full px-3 py-1.5 text-sm"
          />
        </div>

        {/* Language list */}
        <div className="overflow-y-auto flex-1 p-2">
          {modalError && <p className="text-xs text-red-500 px-2 py-1">{modalError}</p>}
          {modalLoading ? (
            <p className="text-xs text-text-muted px-2 py-3">Loading...</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filteredLanguages.map((c) => (
                <Button
                  key={c.code}
                  variant="ghost"
                  onClick={() => handlePickLanguage(c)}
                  className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-left justify-start ${
                    selectedLang === c.code ? "bg-primary/10 text-primary" : ""
                  }`}
                >
                  <span className="text-sm">{c.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-text-muted">{c.voices?.length ?? 0} voices</span>
                    {selectedLang === c.code && (
                      <Check className="size-4" />
                    )}
                  </div>
                </Button>
              ))}
              {filteredLanguages.length === 0 && (
                <p className="text-xs text-text-muted px-2 py-3">No languages found.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
