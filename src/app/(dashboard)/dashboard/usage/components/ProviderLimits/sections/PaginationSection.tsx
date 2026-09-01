"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getPageSizeLabel,
  getConnectionsPaginationSummary,
  ACCOUNT_PAGE_SIZE_OPTIONS,
  ACCOUNT_PAGE_SIZE_MAX,
} from "../utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationSectionProps {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  pageSize: number;
  setPageSize: React.Dispatch<React.SetStateAction<number>>;
  customPageSizeInput: string;
  setCustomPageSizeInput: React.Dispatch<React.SetStateAction<string>>;
  connectionsLoading: boolean;
  refreshingAll: boolean;
}

export default function PaginationSection({
  pagination,
  page: _page,
  setPage,
  pageSize,
  setPageSize,
  customPageSizeInput,
  setCustomPageSizeInput,
  connectionsLoading,
  refreshingAll,
}: PaginationSectionProps) {
  const isCustomPageSize = !ACCOUNT_PAGE_SIZE_OPTIONS.includes(pageSize);
  void (getPageSizeLabel(pageSize, isCustomPageSize));
  const connectionsPageSummary = getConnectionsPaginationSummary(pagination);

  return (
    <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-text-muted">{connectionsPageSummary}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={isCustomPageSize ? "custom" : String(pageSize)}
            onValueChange={(nextValue) => {
              if (nextValue === null || nextValue === "custom") return;
              const nextPageSize = Number.parseInt(nextValue, 10);
              if (Number.isFinite(nextPageSize)) {
                setPage(1);
                setPageSize(nextPageSize);
                setCustomPageSizeInput(String(nextPageSize));
              }
            }}
          >
            <SelectTrigger className="h-8 text-xs" aria-label="Accounts per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option} / page
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            min="1"
            max={String(ACCOUNT_PAGE_SIZE_MAX)}
            inputMode="numeric"
            value={customPageSizeInput}
            onChange={(event) => setCustomPageSizeInput(event.target.value)}
            onBlur={() => {
              const parsedValue = Number.parseInt(customPageSizeInput, 10);
              if (!Number.isFinite(parsedValue)) {
                setCustomPageSizeInput(String(pageSize));
                return;
              }
              const nextPageSize = Math.min(ACCOUNT_PAGE_SIZE_MAX, Math.max(1, parsedValue));
              setPage(1);
              setPageSize(nextPageSize);
              setCustomPageSizeInput(String(nextPageSize));
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              const parsedValue = Number.parseInt(customPageSizeInput, 10);
              if (!Number.isFinite(parsedValue)) {
                setCustomPageSizeInput(String(pageSize));
                return;
              }
              const nextPageSize = Math.min(ACCOUNT_PAGE_SIZE_MAX, Math.max(1, parsedValue));
              setPage(1);
              setPageSize(nextPageSize);
              setCustomPageSizeInput(String(nextPageSize));
            }}
            className="h-8 w-20 px-2 text-xs"
            aria-label="Custom accounts per page"
            placeholder="Custom"
          />
          <span className="text-xs text-text-muted">Page {pagination.page} / {pagination.totalPages}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => setPage(1)}
            disabled={
              pagination.page <= 1 || connectionsLoading || refreshingAll
            }
            className="text-xs"
          >
            First Page
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() =>
              setPage((currentPage) => Math.max(1, currentPage - 1))
            }
            disabled={
              pagination.page <= 1 || connectionsLoading || refreshingAll
            }
            aria-label="Previous accounts page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() =>
              setPage((currentPage) =>
                Math.min(pagination.totalPages, currentPage + 1),
              )
            }
            disabled={
              pagination.page >= pagination.totalPages ||
              connectionsLoading ||
              refreshingAll
            }
            aria-label="Next accounts page"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPage(pagination.totalPages)}
            disabled={
              pagination.page >= pagination.totalPages ||
              connectionsLoading ||
              refreshingAll
            }
            className="text-xs"
          >
            Last Page
          </Button>
        </div>
      </div>
    </div>
  );
}
