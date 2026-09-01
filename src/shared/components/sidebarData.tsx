"use client";

import { BarChart3, CloudUpload, Film, FolderOpen, Globe, Languages, Layers, MessageSquare, Mic, Music, Network, Paintbrush, PieChart, PiggyBank, Puzzle, ScanEye, Server, Settings, Terminal, Webhook, Braces } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const KIND_ICON_MAP: Record<string, LucideIcon> = {
  data_array: Braces, brush: Paintbrush, image_search: ScanEye,
  record_voice_over: Mic, mic: Mic, travel_explore: Globe,
  language: Languages, movie: Film, music_note: Music,
};

export const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
export const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: <Globe className="size-4" />, href: "/dashboard/media-providers/web" };

export const navItems = [
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

export const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: <Terminal /> },
  { href: "/dashboard/translator", label: "Translator", icon: <Languages /> },
];

export const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: <Network /> },
  { href: "/dashboard/skills", label: "Skills", icon: <Puzzle /> },
];
