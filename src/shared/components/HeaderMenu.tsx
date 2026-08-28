"use client";

import { useState } from "react";
import { useTheme } from "@/shared/hooks/useTheme";
import ChangelogModal from "./ChangelogModal";
import { History, LayoutGrid, LogOut, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

interface HeaderMenuProps {
  onLogout: () => void;
}

export default function HeaderMenu({ onLogout }: HeaderMenuProps) {
  const [changelogOpen, setChangelogOpen] = useState(false);
  const { toggleTheme, isDark } = useTheme();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex items-center justify-center p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-2/50 transition-all"
          title="Menu"
        >
          <LayoutGrid className="size-4" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onClick={() => setChangelogOpen(true)}>
            <History className="size-5 text-text-muted" />
            <span className="flex-1 text-left">Registro de Alterações</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toggleTheme()}>
            {isDark ? <Sun className="size-5 text-text-muted" /> : <Moon className="size-5 text-text-muted" />}
            <span className="flex-1 text-left">Tema</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onLogout()}
          >
            <LogOut className="size-5" />
            <span className="flex-1 text-left">Sair</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangelogModal isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </>
  );
}
