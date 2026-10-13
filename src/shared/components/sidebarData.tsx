"use client";

import { Activity, BarChart3, CloudUpload, Film, Globe, Languages, Layers, MessageSquare, Mic, Music, Network, Paintbrush, PieChart, ScanEye, Server, Terminal, Users, Webhook, Braces } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const KIND_ICON_MAP: Record<string, LucideIcon> = {
  data_array: Braces, brush: Paintbrush, image_search: ScanEye,
  record_voice_over: Mic, mic: Mic, travel_explore: Globe,
  language: Languages, movie: Film, music_note: Music,
};

export const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
export const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: <Globe className="size-4" />, href: "/dashboard/media-providers/web" };

/**
 * `adminOnly` items manage the workspace — its providers, combos, usage of
 * everyone — and are hidden from members, whose writes there would be refused
 * anyway (tenantRoute) and whose reads would show other people's requests.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

export const navItems: NavItem[] = [
  { href: "/dashboard/basic-chat", label: "Chat", icon: <MessageSquare /> },
  { href: "/dashboard/usage", label: "Usage", icon: <BarChart3 />, adminOnly: true },
  { href: "/dashboard/requests", label: "Requests", icon: <Activity />, adminOnly: true },
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: <Webhook /> },
  { href: "/dashboard/providers", label: "Providers", icon: <Server />, adminOnly: true },
  { href: "/dashboard/web-providers", label: "Web Session Providers", icon: <Globe />, adminOnly: true },
  { href: "/dashboard/combos", label: "Combo & Vision Adapter", icon: <Layers />, adminOnly: true },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: <PieChart />, adminOnly: true },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: <Terminal />, adminOnly: true },
  { href: "/dashboard/cloud", label: "Cloud Deploy", icon: <CloudUpload />, adminOnly: true },
  { href: "/dashboard/team", label: "Team", icon: <Users /> },
];

export const debugItems: NavItem[] = [
  { href: "/dashboard/console-log", label: "Console Log", icon: <Terminal />, adminOnly: true },
  { href: "/dashboard/translator", label: "Translator", icon: <Languages />, adminOnly: true },
];

export const systemItems: NavItem[] = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: <Network />, adminOnly: true },
];
