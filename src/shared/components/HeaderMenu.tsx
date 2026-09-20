"use client";

import { useState } from "react";
import { useTheme } from "@/shared/hooks/useTheme";
import dynamic from "next/dynamic";
// Este menu está no Header, ou seja em toda rota do dashboard, e o modal
// arrasta react-markdown + remark-gfm + rehype-sanitize. Ele busca o conteúdo
// por fetch quando abre, então nunca é necessário no primeiro paint.
const ChangelogModal = dynamic(() => import("./ChangelogModal"), { ssr: false });
import { History, LogOut, Moon, Sun, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { translate } from "@/i18n/runtime";

interface HeaderMenuProps {
  onLogout: () => void;
  /** Real identity once a real auth provider (OIDC/SAML/Google) is signed in; undefined in local/password mode. */
  displayName?: string | null;
  email?: string | null;
  /** Avatar photo URL — populated once an OAuth provider (e.g. Google) supplies one. */
  avatarUrl?: string | null;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "9R";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function HeaderMenu({ onLogout, displayName, email, avatarUrl }: HeaderMenuProps) {
  const [changelogOpen, setChangelogOpen] = useState(false);
  // Latch em vez de `changelogOpen ? ... : null`: montar condicionalmente
  // adiava o chunk (o que queremos), mas desmontava o modal ao fechar, o que
  // corta a animação de saída do Dialog e joga fora o changelog já buscado —
  // o guard do próprio modal (`!isOpen || markdown`) só evita o refetch
  // enquanto ele continua montado. Mantê-lo sempre montado, por outro lado,
  // baixaria o chunk em toda rota. O latch monta na primeira abertura e não
  // desmonta mais.
  const [changelogMounted, setChangelogMounted] = useState(false);
  const { toggleTheme, isDark } = useTheme();

  const name = displayName || translate("Local account") || "Local account";
  const initials = displayName ? getInitials(displayName) : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-bg transition-all hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring"
          title={name}
        >
          <Avatar size="sm">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
            <AvatarFallback>
              {initials || <User className="size-3.5" />}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-0.5 py-1.5">
            <span className="truncate text-sm font-medium text-text-main">{name}</span>
            <span className="truncate text-xs text-text-muted">{email || translate("No account connected") || "No account connected"}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => { setChangelogMounted(true); setChangelogOpen(true); }}>
            <History className="size-4 text-text-muted" />
            <span className="flex-1 text-left">{translate("Change Log") || "Change Log"}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toggleTheme()}>
            {isDark ? <Sun className="size-4 text-text-muted" /> : <Moon className="size-4 text-text-muted" />}
            <span className="flex-1 text-left">{translate("Theme") || "Theme"}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onLogout()}
          >
            <LogOut className="size-4" />
            <span className="flex-1 text-left">{translate("Logout") || "Logout"}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {changelogMounted ? <ChangelogModal isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} /> : null}
    </>
  );
}
