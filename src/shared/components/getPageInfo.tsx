"use client";

import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS } from "@/shared/constants/providers";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";
import { translate } from "@/i18n/runtime";
import { BarChart3, Globe, Key, Languages, Layers, Monitor, Network, PieChart, PiggyBank, Puzzle, Server, Settings, Terminal, Webhook } from "lucide-react";

export interface Breadcrumb {
  label: string;
  href?: string;
  image?: string;
}

export interface PageInfo {
  title: string;
  description: string;
  icon?: React.ReactNode;
  breadcrumbs: Breadcrumb[];
}

const EMPTY: PageInfo = { title: "", description: "", breadcrumbs: [] };

function matchMediaDetail(pathname: string): PageInfo | null {
  const m = pathname.match(/\/media-providers\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  const kindId = m[1]; const providerId = m[2];
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
  const provider = AI_PROVIDERS[providerId] as Record<string, unknown> | undefined;
  return {
    title: (provider?.name as string) || providerId, description: "",
    breadcrumbs: [
      { label: "Media Providers", href: `/dashboard/media-providers/${kindId}` },
      { label: kindConfig?.label || kindId, href: `/dashboard/media-providers/${kindId}` },
      { label: (provider?.name as string) || providerId, image: getProviderIconSrc(providerId) ?? undefined },
    ],
  };
}

function matchMediaKind(pathname: string): PageInfo | null {
  const m = pathname.match(/\/media-providers\/([^/]+)$/);
  if (!m) return null;
  const kindId = m[1];
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
  return { title: kindConfig?.label || kindId, description: translate("Manage your") + " " + (kindConfig?.label || kindId) + " " + translate("providers"), icon: <Globe className="size-6" />, breadcrumbs: [] };
}

function matchProviderDetail(pathname: string): PageInfo | null {
  const m = pathname.match(/\/providers\/([^/]+)$/);
  if (!m) return null;
  const providerId = m[1];
  const providerInfo = OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId];
  if (!providerInfo) return null;
  return {
    title: providerInfo.name as string, description: "",
    breadcrumbs: [
      { label: "Providers", href: "/dashboard/providers" },
      { label: providerInfo.name as string, image: getProviderIconSrc(providerInfo.id as string) ?? undefined },
    ],
  };
}

const SIMPLE_ROUTES: { test: (p: string) => boolean; title: string; desc: string; icon: React.ReactNode }[] = [
  { test: (p) => p.includes("/providers") && !p.includes("/media-providers"), title: "Providers", desc: "Manage your AI provider connections", icon: <Server className="size-6" /> },
  { test: (p) => p.includes("/combos"), title: "Combos", desc: "Model combos with fallback", icon: <Layers className="size-6" /> },
  { test: (p) => p.includes("/usage"), title: "Usage & Analytics", desc: "Monitor your API usage, token consumption, and request logs", icon: <BarChart3 className="size-6" /> },
  { test: (p) => p.includes("/auth-files"), title: "Auth Files", desc: "Map provider credentials stored in the local database", icon: <Key className="size-6" /> },
  { test: (p) => p.includes("/quota"), title: "Quota Tracker", desc: "Track and manage your API quota limits", icon: <PieChart className="size-6" /> },
  { test: (p) => p.includes("/token-saver"), title: "Token Saver", desc: "Compress prompts and outputs to save tokens", icon: <PiggyBank className="size-6" /> },
  { test: (p) => p.includes("/cli-tools"), title: "CLI Tools", desc: "Configure CLI tools", icon: <Terminal className="size-6" /> },
  { test: (p) => p.includes("/proxy-pools"), title: "Proxy Pools", desc: "Manage your proxy pool settings", icon: <Network className="size-6" /> },
  { test: (p) => p.includes("/skills"), title: "Agent Skills", desc: "Copy a link and paste into your AI to use ModelHub — no installation", icon: <Puzzle className="size-6" /> },
  { test: (p) => p.includes("/endpoint"), title: "Endpoint", desc: "API endpoint configuration", icon: <Webhook className="size-6" /> },
  { test: (p) => p.includes("/profile"), title: "Settings", desc: "Manage your preferences", icon: <Settings className="size-6" /> },
  { test: (p) => p.includes("/translator"), title: "Translator", desc: "Debug translation flow between formats", icon: <Languages className="size-6" /> },
  { test: (p) => p.includes("/console-log"), title: "Console Log", desc: "Live server console output", icon: <Monitor className="size-6" /> },
];

export function getPageInfo(pathname: string | null): PageInfo {
  if (!pathname) return EMPTY;
  return matchMediaDetail(pathname)
    ?? matchMediaKind(pathname)
    ?? matchProviderDetail(pathname)
    ?? (SIMPLE_ROUTES.find((r) => r.test(pathname))
      ? { title: SIMPLE_ROUTES.find((r) => r.test(pathname))!.title, description: SIMPLE_ROUTES.find((r) => r.test(pathname))!.desc, icon: SIMPLE_ROUTES.find((r) => r.test(pathname))!.icon, breadcrumbs: [] }
      : pathname === "/dashboard"
        ? { title: "Endpoint", description: "API endpoint configuration", icon: <Webhook className="size-6" />, breadcrumbs: [] }
        : EMPTY);
}
