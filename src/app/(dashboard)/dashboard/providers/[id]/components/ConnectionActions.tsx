"use client";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

interface ConnectionActionsProps {
  onEdit: () => void;
  onDelete: () => void;
}

export default function ConnectionActions({ onEdit, onDelete }: ConnectionActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" title="Connection actions" aria-label="Connection actions"><MoreHorizontal /></Button>} />
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil /> Edit connection
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 /> Delete connection
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
