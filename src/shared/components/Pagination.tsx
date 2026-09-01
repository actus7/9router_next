"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { translate } from "@/i18n/runtime";
import { PageButtons } from "./PageButtons";

interface PaginationProps {
  currentPage: number; pageSize: number; totalItems: number;
  onPageChange: (page: number) => void; onPageSizeChange?: (pageSize: number) => void; className?: string;
}

export default function Pagination({ currentPage, pageSize, totalItems, onPageChange, onPageSizeChange, className }: PaginationProps) {
  const totalPages = Math.ceil(totalItems / pageSize);
  const startItem = totalItems > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className={cn("flex flex-col sm:flex-row items-center justify-between gap-4 py-4 px-2", className)}>
      {totalItems > 0 && (
        <div className="text-sm text-text-muted">
          {translate("Showing") || "Showing"} <span className="font-medium text-text-main">{startItem}</span> {translate("to") || "to"}{" "}
          <span className="font-medium text-text-main">{endItem}</span> {translate("of") || "of"}{" "}
          <span className="font-medium text-text-main">{totalItems}</span> {translate("results") || "results"}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">{translate("Rows:") || "Rows:"}</span>
            <Select value={String(pageSize)} onValueChange={(val) => onPageSizeChange(Number(val))}>
              <SelectTrigger className="h-9 w-auto"><SelectValue placeholder={translate("Rows:") || "Rows:"} /></SelectTrigger>
              <SelectContent>{[10, 20, 50].map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <PageButtons currentPage={currentPage} totalPages={totalPages} onPageChange={onPageChange} />
      </div>
    </div>
  );
}
