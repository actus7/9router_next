"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import HeaderMenu from "@/shared/components/HeaderMenu";
import HeaderLanguage from "@/shared/components/HeaderLanguage";
import ThemeToggle from "@/shared/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { translate } from "@/i18n/runtime";
import { Search, X } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { SIGN_IN_PATH } from "@/lib/auth/paths";
import { getPageInfo } from "./getPageInfo";
import { HeaderBreadcrumb, HeaderAuthBadge } from "./HeaderParts";

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  // The signed-in account, straight from the Neon Auth session — there is no
  // /api/auth/status to poll any more, and no SAML/OIDC identity to fall back
  // through: one account, one name.
  const { data: session } = authClient.useSession();
  const displayName = session?.user?.name || session?.user?.email || "";
  const email = session?.user?.email || "";
  const { title, description, icon, breadcrumbs } = useMemo(() => getPageInfo(pathname), [pathname]);

  const handleLogout = async () => {
    try {
      await authClient.signOut();
      router.replace(SIGN_IN_PATH);
    } catch (e) {
      console.error("Failed to logout:", e);
    }
  };

  return (
    <header className="shrink-0 flex items-center justify-between gap-3 px-4 lg:px-8 pt-3 pb-2 border-b border-border bg-background/90 backdrop-blur-xl z-20">
      <div className="flex items-center gap-3 shrink-0"><SidebarTrigger /></div>
      <div className="flex flex-col min-w-0 flex-1"><HeaderBreadcrumb breadcrumbs={breadcrumbs} title={title} description={description} icon={icon} /></div>
      <div className="flex items-center gap-1 shrink-0">
        <HeaderAuthBadge displayName={displayName} loginMethod={displayName ? "Neon Auth" : ""} />
        <HeaderSearch />
        <ThemeToggle />
        <HeaderLanguage />
        <HeaderMenu onLogout={handleLogout} displayName={displayName || null} email={email || null} />
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
      <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-text-muted" />
      <Input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} className="h-8 w-full pl-8 pr-7 text-sm" />
      {query && <Button variant="ghost" size="icon-xs" type="button" onClick={() => setQuery("")} className="absolute right-1 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main" aria-label={translate("Clear search") || "Clear search"}><X className="size-4" /></Button>}
    </div>
  );
}
