"use client";

import Link from "next/link";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { ChevronRight, User } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface Breadcrumb { label: string; href?: string; image?: string; }

interface HeaderBreadcrumbProps {
  breadcrumbs: Breadcrumb[]; title: string; description: string; icon?: React.ReactNode;
}

export function HeaderBreadcrumb({ breadcrumbs, title, description, icon }: HeaderBreadcrumbProps) {
  if (breadcrumbs.length > 0) {
    return (
      <div className="flex items-center gap-2">
        {breadcrumbs.map((crumb, i) => (
          <div key={`${crumb.label}-${crumb.href || "current"}`} className="flex items-center gap-2">
            {i > 0 && <ChevronRight className="size-4" />}
            {crumb.href ? (
              <Link href={crumb.href} className="text-text-muted hover:text-primary transition-colors">{crumb.label}</Link>
            ) : (
              <div className="flex items-center gap-2">
                {crumb.image && <ProviderIcon src={crumb.image} alt={crumb.label} size={28} className="object-contain rounded max-w-[28px] max-h-[28px]" fallbackText={crumb.label.slice(0, 2).toUpperCase()} />}
                <h1 className="text-base lg:text-2xl font-semibold text-text-main tracking-tight truncate">{translate(crumb.label)}</h1>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (!title) return null;
  return (
    <div>
      <div className="flex items-center gap-2">
        {icon && <span className="text-primary [&>svg]:size-5 lg:[&>svg]:size-6">{icon}</span>}
        <h1 className="text-base lg:text-2xl font-semibold tracking-tight truncate">{translate(title)}</h1>
      </div>
      {description && <p className="hidden lg:block text-sm text-text-muted truncate">{translate(description)}</p>}
    </div>
  );
}

interface HeaderAuthBadgeProps { displayName: string; loginMethod: string; }

export function HeaderAuthBadge({ displayName, loginMethod }: HeaderAuthBadgeProps) {
  if (!displayName || (loginMethod !== "OIDC" && loginMethod !== "SAML")) return null;
  return (
    <div className="hidden sm:flex items-center max-w-[220px] px-3 py-1.5 rounded-full border border-border bg-surface/70 text-xs text-text-muted truncate" title={displayName}>
      <User className="size-4" /><span className="truncate">{displayName}</span>
      <span className="ml-2 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">{loginMethod}</span>
    </div>
  );
}
