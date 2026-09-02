"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import { APP_CONFIG } from "@/shared/constants/config";
import {
  Sidebar as SidebarPrimitive, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarSeparator, useSidebar,
} from "@/components/ui/sidebar";
import { Settings } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { navItems, debugItems, systemItems } from "./sidebarData";
import { SidebarMediaProviders } from "./SidebarMediaProviders";

export default function Sidebar() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const [mediaOpen, setMediaOpen] = useState(() => pathname.startsWith("/dashboard/media-providers"));

  const { data: settings } = useSWR<Record<string, unknown>>("/api/settings", jsonFetcher);
  const enableTranslator = !!settings?.enableTranslator;

  const isActive = (href: string): boolean => {
    if (href === "/dashboard/usage") return pathname === "/dashboard" || pathname.startsWith("/dashboard/usage");
    return pathname.startsWith(href);
  };
  const closeOnMobile = () => { if (isMobile) setOpenMobile(false); };

  const renderNavItem = (item: { href: string; label: string; icon: React.ReactNode }) => (
    <SidebarMenuItem key={item.href}>
      <SidebarMenuButton isActive={isActive(item.href)} tooltip={translate(item.label) || item.label} render={<Link href={item.href} onClick={closeOnMobile} aria-current={isActive(item.href) ? "page" : undefined} />}>
        {item.icon}<span>{translate(item.label) || item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <SidebarPrimitive collapsible="icon" variant="inset">
      <SidebarHeader className="gap-2 p-3">
        <Link href="/dashboard" className="flex items-center gap-3 rounded-xl px-1 py-1" onClick={closeOnMobile}>
          <Image
            src="/icons/icon-192.png"
            alt="ModelHub"
            width={40}
            height={40}
            priority
            className="size-10 shrink-0 object-contain"
          />
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-lg font-semibold tracking-tight text-sidebar-foreground">{APP_CONFIG.name}</span>
            <span className="truncate text-xs text-sidebar-foreground/60">v{APP_CONFIG.version}</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup><SidebarGroupContent><SidebarMenu>{navItems.map(renderNavItem)}</SidebarMenu></SidebarGroupContent></SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel>{translate("System") || "System"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMediaProviders pathname={pathname} mediaOpen={mediaOpen} setMediaOpen={setMediaOpen} closeOnMobile={closeOnMobile} />
              {systemItems.map(renderNavItem)}
              {debugItems.map((item) => { if (item.href === "/dashboard/translator" && !enableTranslator) return null; return renderNavItem(item); })}
              <SidebarMenuItem>
                <SidebarMenuButton isActive={isActive("/dashboard/profile")} tooltip={translate("Settings") || "Settings"} render={<Link href="/dashboard/profile" onClick={closeOnMobile} aria-current={isActive("/dashboard/profile") ? "page" : undefined} />}>
                  <Settings /><span>{translate("Settings") || "Settings"}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </SidebarPrimitive>
  );
}
