"use client";

import React from "react";
import { cn } from "@/lib/utils";
import Button from "@/shared/components/Button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { getPageNumbers } from "./getPageNumbers";

interface PaginationProps {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  className?: string;
}

export default function Pagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  className,
}: PaginationProps) {
  const totalPages = Math.ceil(totalItems / pageSize);
  const startItem = totalItems > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endItem = Math.min(currentPage * pageSize, totalItems);
  const pageNumbers = getPageNumbers(currentPage, totalPages);

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-4 py-4 px-2",
        className
      )}
    >
      {/* Info text */}
      {totalItems > 0 && (
        <div className="text-sm text-text-muted">
          {translate("Showing") || "Showing"} <span className="font-medium text-text-main">{startItem}</span> {translate("to") || "to"}{" "}
          <span className="font-medium text-text-main">{endItem}</span> {translate("of") || "of"}{" "}
          <span className="font-medium text-text-main">{totalItems}</span> {translate("results") || "results"}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
        {/* Page size selector */}
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">{translate("Rows:") || "Rows:"}</span>
            <Select value={String(pageSize)} onValueChange={(val) => onPageSizeChange(Number(val))}>
              <SelectTrigger className="h-9 w-auto">
                <SelectValue placeholder={translate("Rows:") || "Rows:"} />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="w-9 px-0"
            >
              <ChevronLeft className="size-5" />
            </Button>

            {pageNumbers[0] > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPageChange(1)}
                  className="w-9 px-0 hidden sm:inline-flex"
                >
                  1
                </Button>
                {pageNumbers[0] > 2 && (
                  <span className="text-text-muted px-1 hidden sm:inline">...</span>
                )}
              </>
            )}

            {pageNumbers.map((page) => (
              <Button
                key={page}
                variant={currentPage === page ? "default" : "ghost"}
                size="sm"
                onClick={() => onPageChange(page)}
                className={cn(
                  "w-9 px-0",
                  currentPage === page ? "inline-flex" : "hidden sm:inline-flex"
                )}
              >
                {page}
              </Button>
            ))}

            {pageNumbers[pageNumbers.length - 1] < totalPages && (
              <>
                {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                  <span className="text-text-muted px-1 hidden sm:inline">...</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPageChange(totalPages)}
                  className="w-9 px-0 hidden sm:inline-flex"
                >
                  {totalPages}
                </Button>
              </>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="w-9 px-0"
            >
              <ChevronRight className="size-5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
