"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { APP_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import Button from "@/shared/components/Button";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { BarChart3, Film, FolderOpen, Globe, Languages, Layers, Mic, Music, Network, Paintbrush, PieChart, PiggyBank, Puzzle, ScanEye, Server, Settings, Terminal, Webhook, Braces } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const KIND_ICON_MAP: Record<string, LucideIcon> = {
  data_array: Braces,
  brush: Paintbrush,
  image_search: ScanEye,
  record_voice_over: Mic,
  mic: Mic,
  travel_explore: Globe,
  language: Languages,
  movie: Film,
  music_note: Music,
};

function getKindIcon(iconName: string): React.ReactNode {
  const IconComponent = KIND_ICON_MAP[iconName];
  return IconComponent ? <IconComponent className="size-4" /> : <FolderOpen className="size-4" />;
}

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Busca", icon: <Globe className="size-4" />, href: "/dashboard/media-providers/web" };

const navItems = [
  { href: "/dashboard/usage", label: "Uso", icon: <BarChart3 className="size-5" /> },
  { href: "/dashboard/endpoint", label: "Endpoint & Chave", icon: <Webhook className="size-5" /> },
  { href: "/dashboard/providers", label: "Provedores", icon: <Server className="size-5" /> },
  // { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }, // Hidden
  { href: "/dashboard/combos", label: "Combo & Adaptador de Visão", icon: <Layers className="size-5" /> },
  { href: "/dashboard/quota", label: "Rastreador de Cota", icon: <PieChart className="size-5" /> },
  { href: "/dashboard/token-saver", label: "Economizador de Tokens", icon: <PiggyBank className="size-5" /> },
  // { href: "/dashboard/pxpipe", label: "PXPIPE", icon: "image" },
  { href: "/dashboard/cli-tools", label: "Ferramentas CLI", icon: <Terminal className="size-5" /> },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Log do Console", icon: <Terminal className="size-5" /> },
  { href: "/dashboard/translator", label: "Tradutor", icon: <Languages className="size-5" /> },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Pools de Proxy", icon: <Network className="size-5" /> },
  { href: "/dashboard/skills", label: "Habilidades", icon: <Puzzle className="size-5" /> },
];

interface SidebarProps {
  onClose?: () => void;
}

export default function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname();
  const [enableTranslator, setEnableTranslator] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => { if (data.enableTranslator) setEnableTranslator(true); })
      .catch(() => {});
  }, []);

  const isActive = (href: string): boolean => {
    if (href === "/dashboard/usage") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/usage");
    }
    return pathname.startsWith(href);
  };


  return (
    <>
      <aside aria-label="Navegação principal" className="flex w-72 flex-col border-r border-border-subtle bg-vibrancy backdrop-blur-xl transition-colors duration-300 min-h-full">
        {/* Traffic lights */}
        <div className="flex items-center gap-2 px-6 pt-5 pb-2" aria-hidden="true">
          <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
          <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
          <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
        </div>

        {/* Logo */}
        <div className="px-6 py-4 flex flex-col gap-2">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex items-center justify-center size-9 rounded-[10px] bg-gradient-to-br from-brand-500 to-brand-700 shadow-[var(--shadow-warm)]">
              <Network className="size-5" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold tracking-tight text-text-main">
                {APP_CONFIG.name}
              </h1>
              <span className="text-xs text-text-muted">v{APP_CONFIG.version}</span>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-2 space-y-0.5 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                isActive(item.href)
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
            >
              {item.icon}
              <span className="text-[13px] font-medium">{item.label}</span>
            </Link>
          ))}

          {/* System section */}
          <div className="pt-3 mt-2 space-y-0.5">
            <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
              Sistema
            </p>

            {/* Media Providers accordion */}
            <Accordion className="w-full">
              <AccordionItem value="media-providers" className="border-b-0">
                <AccordionTrigger
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-1 rounded-lg transition-all group justify-start h-auto text-sm font-medium",
                    pathname.startsWith("/dashboard/media-providers")
                      ? "bg-primary/10 text-primary"
                      : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                  )}
                >
                  <FolderOpen className="size-5" />
                  <span className="text-[13px] font-medium flex-1 text-left">Provedores de Mídia</span>
                </AccordionTrigger>
                <AccordionContent className="pl-4">
                  <div id="media-providers-submenu" role="group">
                    {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                      <Link
                        key={kind.id}
                        href={`/dashboard/media-providers/${kind.id}`}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-3 px-4 py-1 rounded-lg transition-all group",
                          pathname.startsWith(`/dashboard/media-providers/${kind.id}`)
                            ? "bg-primary/10 text-primary"
                            : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                        )}
                      >
                        {getKindIcon(kind.icon)}
                        <span className="text-sm">{kind.label}</span>
                      </Link>
                    ))}
                    <Link
                      key={COMBINED_WEB_ITEM.id}
                      href={COMBINED_WEB_ITEM.href}
                      onClick={onClose}
                      className={cn(
                        "flex items-center gap-3 px-4 py-1 rounded-lg transition-all group",
                        pathname.startsWith(COMBINED_WEB_ITEM.href)
                          ? "bg-primary/10 text-primary"
                          : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                      )}
                    >
                      {COMBINED_WEB_ITEM.icon}
                      <span className="text-sm">{COMBINED_WEB_ITEM.label}</span>
                    </Link>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {systemItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                  isActive(item.href)
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                )}
              >
                {item.icon}
                <span className="text-[13px] font-medium">{item.label}</span>
              </Link>
            ))}

            {/* Debug items (inside System section, before Settings) */}
            {debugItems.map((item) => {
              const show = item.href !== "/dashboard/translator" || enableTranslator;
              return show ? (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                    isActive(item.href)
                      ? "bg-primary/10 text-primary"
                      : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                  )}
                >
                  {item.icon}
                  <span className="text-[13px] font-medium">{item.label}</span>
                </Link>
              ) : null;
            })}

            {/* Settings */}
            <Link
              href="/dashboard/profile"
              onClick={onClose}
              aria-current={isActive("/dashboard/profile") ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                isActive("/dashboard/profile")
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
            >
              <Settings className="size-5" />
              <span className="text-[13px] font-medium">Configurações</span>
            </Link>
          </div>
        </nav>

      </aside>

    </>
  );
}
