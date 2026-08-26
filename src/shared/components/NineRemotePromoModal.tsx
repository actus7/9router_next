"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: "terminal", label: "Terminal", desc: "Full shell access" },
  { icon: "cast", label: "Desktop", desc: "Screen sharing" },
  { icon: "folder_open", label: "Files", desc: "Browse & edit files" },
];

const BULLETS = [
  { icon: "qr_code_scanner", text: "Scan QR to connect instantly" },
  { icon: "wifi_off", text: "No port forwarding needed" },
  { icon: "devices", text: "Works on any device" },
];

const NINE_REMOTE_URL = "https://9remote.cc";

interface NineRemotePromoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NineRemotePromoModal({ isOpen, onClose }: NineRemotePromoModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">9Remote</DialogTitle>

        {/* Header */}
        <div className="flex items-center px-5 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-[8px] flex items-center justify-center bg-primary">
              <span className="material-symbols-outlined text-white text-base">terminal</span>
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-primary font-mono">9Remote</span>
          </div>
        </div>

        {/* Body */}
        <div className="px-7 py-7 pb-9 flex flex-col gap-6">
          {/* Hero */}
          <div className="flex flex-col items-center gap-2 text-center mt-2">
            <div className="w-14 h-14 rounded-[14px] flex items-center justify-center mb-1 bg-primary shadow-[var(--shadow-warm)]">
              <span className="material-symbols-outlined text-white text-[30px]">terminal</span>
            </div>
            <h1 className="text-lg font-bold text-text-main tracking-tight">9Remote</h1>
            <p className="text-xs text-text-muted leading-5 max-w-[220px]">
              Access your terminal, desktop &amp; files from anywhere
            </p>
          </div>

          {/* Feature cards */}
          <div className="flex gap-2 w-full">
            {FEATURES.map(({ icon, label, desc }) => (
              <div key={label} className="flex-1 flex flex-col items-center gap-1.5 py-4 px-1 rounded-[10px] border border-border-subtle bg-surface-2">
                <span className="material-symbols-outlined text-primary text-[22px]">{icon}</span>
                <p className="text-xs font-semibold text-text-main">{label}</p>
                <p className="text-[10px] text-text-muted text-center leading-4">{desc}</p>
              </div>
            ))}
          </div>

          {/* Bullets */}
          <div className="flex flex-col gap-3 w-full">
            {BULLETS.map(({ icon, text }) => (
              <div key={icon} className="flex items-center gap-2.5">
                <span className="material-symbols-outlined flex-shrink-0 text-primary text-[16px]">{icon}</span>
                <span className="text-xs text-text-muted">{text}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <Button
            onClick={() => window.open(NINE_REMOTE_URL, "_blank")}
            className="w-full py-3 h-auto rounded-[10px] shadow-[var(--shadow-warm)]"
          >
            <span className="material-symbols-outlined text-base">open_in_new</span>
            Get 9Remote
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
