"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import Button from "@/shared/components/Button";
import { ExternalLink, FolderOpen, MonitorSmartphone, QrCode, Terminal, Tv, WifiOff } from "lucide-react";

const FEATURES = [
  { icon: <Terminal className="size-6 text-primary" />, label: "Terminal", desc: "Full shell access" },
  { icon: <Tv className="size-6 text-primary" />, label: "Desktop", desc: "Screen sharing" },
  { icon: <FolderOpen className="size-6 text-primary" />, label: "Files", desc: "Browse & edit files" },
];

const BULLETS = [
  { id: "qr", icon: <QrCode className="size-4 text-primary" />, text: "Scan QR to connect instantly" },
  { id: "wifi", icon: <WifiOff className="size-4 text-primary" />, text: "No port forwarding needed" },
  { id: "devices", icon: <MonitorSmartphone className="size-4 text-primary" />, text: "Works on any device" },
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
              <Terminal className="size-4" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-primary font-mono">9Remote</span>
          </div>
        </div>

        {/* Body */}
        <div className="px-7 py-7 pb-9 flex flex-col gap-6">
          {/* Hero */}
          <div className="flex flex-col items-center gap-2 text-center mt-2">
            <div className="w-14 h-14 rounded-[14px] flex items-center justify-center mb-1 bg-primary shadow-[var(--shadow-warm)]">
              <Terminal className="size-8" />
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
                {icon}
                <p className="text-xs font-semibold text-text-main">{label}</p>
                <p className="text-[10px] text-text-muted text-center leading-4">{desc}</p>
              </div>
            ))}
          </div>

          {/* Bullets */}
          <div className="flex flex-col gap-3 w-full">
            {BULLETS.map(({ id, icon, text }) => (
              <div key={id} className="flex items-center gap-2.5">
                {icon}
                <span className="text-xs text-text-muted">{text}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <Button
            onClick={() => window.open(NINE_REMOTE_URL, "_blank")}
            className="w-full py-3 h-auto rounded-[10px] shadow-[var(--shadow-warm)]"
          >
            <ExternalLink className="size-4" />
            Get 9Remote
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
