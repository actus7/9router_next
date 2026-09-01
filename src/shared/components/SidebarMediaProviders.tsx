"use client";

import Link from "next/link";
import { FolderOpen, ChevronRight } from "lucide-react";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import {
  SidebarMenuItem, SidebarMenuButton, SidebarMenuSub,
  SidebarMenuSubButton, SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { translate } from "@/i18n/runtime";
import { KIND_ICON_MAP, VISIBLE_MEDIA_KINDS, COMBINED_WEB_ITEM } from "./sidebarData";

function getKindIcon(iconName: string): React.ReactNode {
  const IconComponent = KIND_ICON_MAP[iconName];
  return IconComponent ? <IconComponent className="size-4" /> : <FolderOpen className="size-4" />;
}

interface SidebarMediaProvidersProps {
  pathname: string;
  mediaOpen: boolean;
  setMediaOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  closeOnMobile: () => void;
}

export function SidebarMediaProviders({ pathname, mediaOpen, setMediaOpen, closeOnMobile }: SidebarMediaProvidersProps) {
  return (
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
              <SidebarMenuSubButton isActive={pathname.startsWith(`/dashboard/media-providers/${kind.id}`)} render={<Link href={`/dashboard/media-providers/${kind.id}`} onClick={closeOnMobile} />}>
                {getKindIcon(kind.icon)}<span>{kind.label}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
          <SidebarMenuSubItem>
            <SidebarMenuSubButton isActive={pathname.startsWith(COMBINED_WEB_ITEM.href)} render={<Link href={COMBINED_WEB_ITEM.href} onClick={closeOnMobile} />}>
              {COMBINED_WEB_ITEM.icon}<span>{translate(COMBINED_WEB_ITEM.label) || COMBINED_WEB_ITEM.label}</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}
