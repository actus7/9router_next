"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import ProviderIcon from "@/shared/components/ProviderIcon";
import HeaderMenu from "@/shared/components/HeaderMenu";
import HeaderLanguage from "@/shared/components/HeaderLanguage";
import ThemeToggle from "@/shared/components/ThemeToggle";
import Button from "@/shared/components/Button";
import { Input } from "@/components/ui/input";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS } from "@/shared/constants/providers";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";
import { translate } from "@/i18n/runtime";
import { BarChart3, ChevronRight, Globe, Key, Languages, Layers, Menu, Monitor, Network, PieChart, PiggyBank, Puzzle, Search, Server, Settings, Terminal, User, Webhook, X } from "lucide-react";

interface Breadcrumb {
  label: string;
  href?: string;
  image?: string;
}

interface PageInfo {
  title: string;
  description: string;
  icon?: React.ReactNode;
  breadcrumbs: Breadcrumb[];
}

const getPageInfo = (pathname: string | null): PageInfo => {
  if (!pathname) return { title: "", description: "", breadcrumbs: [] };

  // Media provider detail: /dashboard/media-providers/[kind]/[id]
  const mediaDetailMatch = pathname.match(/\/media-providers\/([^/]+)\/([^/]+)$/);
  if (mediaDetailMatch) {
    const kindId = mediaDetailMatch[1];
    const providerId = mediaDetailMatch[2];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    const provider = AI_PROVIDERS[providerId] as Record<string, unknown> | undefined;
    return {
      title: (provider?.name as string) || providerId,
      description: "",
      breadcrumbs: [
        { label: "Provedores de Mídia", href: `/dashboard/media-providers/${kindId}` },
        { label: kindConfig?.label || kindId, href: `/dashboard/media-providers/${kindId}` },
        { label: (provider?.name as string) || providerId, image: getProviderIconSrc(providerId) ?? undefined },
      ],
    };
  }

  // Media provider kind: /dashboard/media-providers/[kind]
  const mediaKindMatch = pathname.match(/\/media-providers\/([^/]+)$/);
  if (mediaKindMatch) {
    const kindId = mediaKindMatch[1];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    return {
      title: kindConfig?.label || kindId,
      description: `Gerencie seus provedores de ${kindConfig?.label || kindId}`,
      icon: <Globe className="size-6" />,
      breadcrumbs: [],
    };
  }

  // Provider detail page: /dashboard/providers/[id]
  const providerMatch = pathname.match(/\/providers\/([^/]+)$/);
  if (providerMatch) {
    const providerId = providerMatch[1];
    const providerInfo =
      OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId];
    if (providerInfo) {
      return {
        title: providerInfo.name as string,
        description: "",
        breadcrumbs: [
          { label: "Provedores", href: "/dashboard/providers" },
          {
            label: providerInfo.name as string,
            image: getProviderIconSrc(providerInfo.id as string) ?? undefined,
          },
        ],
      };
    }
  }

  if (pathname.includes("/providers") && !pathname.includes("/media-providers"))
    return {
      title: "Provedores",
      description: "Gerencie suas conexões com provedores de IA",
      icon: <Server className="size-6" />,
      breadcrumbs: [],
    };
  if (pathname.includes("/combos"))
    return {
      title: "Combos",
      description: "Combos de modelos com fallback",
      icon: <Layers className="size-6" />,
      breadcrumbs: [],
    };
  if (pathname.includes("/usage"))
    return {
      title: "Uso & Análises",
      description:
        "Monitore seu uso de API, consumo de tokens e logs de requisições",
      icon: <BarChart3 className="size-6" />,
      breadcrumbs: [],
    };
  if (pathname.includes("/auth-files"))
    return {
      title: "Arquivos de Autenticação",
      description: "Mapeie credenciais de provedores armazenadas no banco local",
      icon: <Key className="size-6" />,
      breadcrumbs: [],
    };
  if (pathname.includes("/quota"))
    return {
      title: "Rastreador de Cota",
      description: "Acompanhe e gerencie seus limites de cota da API",
      icon: <PieChart className="size-6" />,
      breadcrumbs: [],
    };
  if (pathname.includes("/token-saver"))
    return {
      title: "Economizador de Tokens",
      description: "Comprima prompts e saídas para economizar tokens",
      icon: <PiggyBank className="size-6" />,
      breadcrumbs: [],
    };
  if (pathname.includes("/cli-tools"))
    return {
      title: "Ferramentas CLI",
      description: "Configure ferramentas CLI",
      icon: <Terminal className="size-6" />,
      breadcrumbs: [],
    };
  if (pathname.includes("/proxy-pools"))
    return {
      title: "Pools de Proxy",
      description: "Gerencie suas configurações de pools de proxy",
      icon: <Network className="size-6" />,
      breadcrumbs: [],
    };
  if (pathname.includes("/skills"))
    return {
      title: "Habilidades do Agente",
      description: "Copie um link e cole no seu IA para usar o 9Router — sem instalação",
      icon: <Puzzle className="size-6" />,
      breadcrumbs: [],
    };
  if (pathname.includes("/endpoint"))
    return {
      title: "Endpoint",
      description: "Configuração do endpoint da API",
      icon: <Webhook className="size-6" />,
      breadcrumbs: [],
    };
  if (pathname.includes("/profile"))
    return {
      title: "Configurações",
      description: "Gerencie suas preferências",
      icon: <Settings className="size-6" />,
      breadcrumbs: [],
    };
  if (pathname.includes("/translator"))
    return {
      title: "Tradutor",
      description: "Depure o fluxo de tradução entre formatos",
      icon: <Languages className="size-6" />,
      breadcrumbs: [],
    };
  if (pathname.includes("/console-log"))
    return {
      title: "Log do Console",
      description: "Saída ao vivo do console do servidor",
      icon: <Monitor className="size-6" />,
      breadcrumbs: [],
    };
  if (pathname === "/dashboard")
    return {
      title: "Endpoint",
      description: "Configuração do endpoint da API",
      icon: <Webhook className="size-6" />,
      breadcrumbs: [],
    };
  return { title: "", description: "", breadcrumbs: [] };
};

interface HeaderProps {
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

export default function Header({ onMenuClick, showMenuButton = true }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [loginMethod, setLoginMethod] = useState("");

  // Memoize page info to prevent unnecessary recalculations
  const pageInfo = useMemo(() => getPageInfo(pathname), [pathname]);
  const { title, description, icon, breadcrumbs } = pageInfo;

  useEffect(() => {
    let cancelled = false;

    async function loadAuthStatus() {
      try {
        const res = await fetch("/api/auth/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setDisplayName(data?.displayName || data?.samlName || data?.samlEmail || data?.oidcName || data?.oidcEmail || "");
          setLoginMethod(data?.loginMethod || "");
        }
      } catch {
        if (!cancelled) {
          setDisplayName("");
          setLoginMethod("");
        }
      }
    }

    loadAuthStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        router.replace("/login");
      }
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  return (
    <header className="shrink-0 flex items-center justify-between gap-3 px-4 lg:px-8 pt-3 pb-2 border-b border-border-subtle bg-surface/60 backdrop-blur-xl lg:bg-transparent lg:backdrop-blur-none z-20">
      {/* Mobile menu button */}
      <div className="flex items-center gap-3 lg:hidden shrink-0">
        {showMenuButton && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            aria-label="Abrir menu de navegação"
            aria-expanded="false"
            className="text-text-main hover:text-primary"
          >
            <Menu className="size-4" />
          </Button>
        )}
      </div>

      {/* Page title with breadcrumbs */}
      <div className="flex flex-col min-w-0 flex-1">
        {breadcrumbs.length > 0 ? (
          <div className="flex items-center gap-2">
            {breadcrumbs.map((crumb, index) => (
              <div
                key={`${crumb.label}-${crumb.href || "current"}`}
                className="flex items-center gap-2"
              >
                {index > 0 && (
                  <ChevronRight className="size-4" />
                )}
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="text-text-muted hover:text-primary transition-colors"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <div className="flex items-center gap-2">
                    {crumb.image && (
                      <ProviderIcon
                        src={crumb.image}
                        alt={crumb.label}
                        size={28}
                        className="object-contain rounded max-w-[28px] max-h-[28px]"
                        fallbackText={crumb.label.slice(0, 2).toUpperCase()}
                      />
                    )}
                    <h1 className="text-base lg:text-2xl font-semibold text-text-main tracking-tight truncate">
                      {translate(crumb.label)}
                    </h1>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : title ? (
          <div>
            <div className="flex items-center gap-2">
              {icon && (
                <span className="text-primary [&>svg]:size-5 lg:[&>svg]:size-6">
                  {icon}
                </span>
              )}
              <h1 className="text-base lg:text-2xl font-semibold tracking-tight truncate">
                {translate(title)}
              </h1>
            </div>
            {description && (
              <p className="hidden lg:block text-sm text-text-muted truncate">
                {translate(description)}
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1 shrink-0">
        {displayName && (loginMethod === "OIDC" || loginMethod === "SAML") && (
          <div
            className="hidden sm:flex items-center max-w-[220px] px-3 py-1.5 rounded-full border border-border bg-surface/70 text-xs text-text-muted truncate"
            title={displayName}
          >
            <User className="size-4" />
            <span className="truncate">{displayName}</span>
            <span className="ml-2 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              {loginMethod}
            </span>
          </div>
        )}
        <HeaderSearch />
        <ThemeToggle />
        <HeaderLanguage />
        <HeaderMenu onLogout={handleLogout} />
      </div>
    </header>
  );
}

function HeaderSearch() {
  const visible = useHeaderSearchStore((s) => s.visible);
  const query = useHeaderSearchStore((s) => s.query);
  const placeholder = useHeaderSearchStore((s) => s.placeholder);
  const setQuery = useHeaderSearchStore((s) => s.setQuery);

  if (!visible) return null;

  return (
    <div className="relative w-[160px] sm:w-[220px]">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-text-muted"
      />
      <Input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full pl-8 pr-7 text-sm"
      />
      {query && (
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          onClick={() => setQuery("")}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main"
          aria-label="Limpar busca"
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
