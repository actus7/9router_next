"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import {
  Sidebar as SidebarPrimitive,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { BarChart3, ChevronRight, CloudUpload, Film, FolderOpen, Globe, Languages, Layers, MessageSquare, Mic, Music, Network, Paintbrush, PieChart, PiggyBank, Puzzle, ScanEye, Server, Settings, Terminal, Webhook, Braces } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { translate } from "@/i18n/runtime";

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
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: <Globe className="size-4" />, href: "/dashboard/media-providers/web" };

const navItems = [
  { href: "/dashboard/basic-chat", label: "Chat", icon: <MessageSquare /> },
  { href: "/dashboard/usage", label: "Usage", icon: <BarChart3 /> },
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: <Webhook /> },
  { href: "/dashboard/providers", label: "Providers", icon: <Server /> },
  { href: "/dashboard/combos", label: "Combo & Vision Adapter", icon: <Layers /> },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: <PieChart /> },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: <PiggyBank /> },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: <Terminal /> },
  { href: "/dashboard/cloud", label: "Cloud Deploy", icon: <CloudUpload /> },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: <Terminal /> },
  { href: "/dashboard/translator", label: "Translator", icon: <Languages /> },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: <Network /> },
  { href: "/dashboard/skills", label: "Skills", icon: <Puzzle /> },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const [enableTranslator, setEnableTranslator] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(() => pathname.startsWith("/dashboard/media-providers"));

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

  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SidebarPrimitive collapsible="icon" variant="inset">
      <SidebarHeader className="gap-2 p-3">
        <Link href="/dashboard" className="flex items-center gap-3 rounded-xl px-1 py-1" onClick={closeOnMobile}>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-[var(--shadow-warm)]">
            <Network className="size-5 text-white" />
          </div>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-lg font-semibold tracking-tight text-sidebar-foreground">
              {APP_CONFIG.name}
            </span>
            <span className="truncate text-xs text-sidebar-foreground/60">v{APP_CONFIG.version}</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(item.href)}
                    tooltip={translate(item.label) || item.label}
                    render={<Link href={item.href} onClick={closeOnMobile} aria-current={isActive(item.href) ? "page" : undefined} />}
                  >
                    {item.icon}
                    <span>{translate(item.label) || item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>{translate("System") || "System"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Media Providers submenu */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname.startsWith("/dashboard/media-providers")}
                  tooltip={translate("Media Providers") || "Media Providers"}
                  onClick={() => setMediaOpen((v) => !v)}
                >
                  <FolderOpen />
                  <span className="flex-1">{translate("Media Providers") || "Media Providers"}</span>
                  <ChevronRight className={`size-4 shrink-0 transition-transform ${mediaOpen ? "rotate-90" : ""}`} />
                </SidebarMenuButton>
                {mediaOpen && (
                  <SidebarMenuSub>
                    {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                      <SidebarMenuSubItem key={kind.id}>
                        <SidebarMenuSubButton
                          isActive={pathname.startsWith(`/dashboard/media-providers/${kind.id}`)}
                          render={<Link href={`/dashboard/media-providers/${kind.id}`} onClick={closeOnMobile} />}
                        >
                          {getKindIcon(kind.icon)}
                          <span>{kind.label}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        isActive={pathname.startsWith(COMBINED_WEB_ITEM.href)}
                        render={<Link href={COMBINED_WEB_ITEM.href} onClick={closeOnMobile} />}
                      >
                        {COMBINED_WEB_ITEM.icon}
                        <span>{translate(COMBINED_WEB_ITEM.label) || COMBINED_WEB_ITEM.label}</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>

              {systemItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(item.href)}
                    tooltip={translate(item.label) || item.label}
                    render={<Link href={item.href} onClick={closeOnMobile} aria-current={isActive(item.href) ? "page" : undefined} />}
                  >
                    {item.icon}
                    <span>{translate(item.label) || item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {/* Debug items (inside System section, before Settings) */}
              {debugItems.map((item) => {
                const show = item.href !== "/dashboard/translator" || enableTranslator;
                if (!show) return null;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive(item.href)}
                      tooltip={translate(item.label) || item.label}
                      render={<Link href={item.href} onClick={closeOnMobile} />}
                    >
                      {item.icon}
                      <span>{translate(item.label) || item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}

              {/* Settings */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isActive("/dashboard/profile")}
                  tooltip={translate("Settings") || "Settings"}
                  render={<Link href="/dashboard/profile" onClick={closeOnMobile} aria-current={isActive("/dashboard/profile") ? "page" : undefined} />}
                >
                  <Settings />
                  <span>{translate("Settings") || "Settings"}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </SidebarPrimitive>
  );
}
