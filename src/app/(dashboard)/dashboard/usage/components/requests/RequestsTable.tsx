"use client";

import { ArrowRight, ArrowRightLeft, ChevronRight, X } from "lucide-react";
import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import Pagination from "@/shared/components/Pagination";
import { translate } from "@/i18n/runtime";
import type { RequestRow } from "./types";
import { formatClock, formatCostCell, formatShortDate, modelJump, totalTokens } from "./requestFormat";
import { getCachedTokens, getCacheCreationTokens } from "../tokenUtils";

function t(text: string): string {
  return translate(text) || text;
}

const HEAD = "px-3 py-2 text-xs font-semibold uppercase tracking-wider text-text-muted";
const CELL = "px-3 py-2 text-xs";
const CELL_NUM = "px-3 py-2 text-right font-mono text-xs";
const PILL =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium";

function StatusPill({ statusLabel, cause }: { statusLabel?: string; cause?: string }) {
  const status = (statusLabel || "").toLowerCase();
  const tone =
    status === "success"
      ? "border-success-border/30 bg-success/10 text-success"
      : status === "failed"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-border bg-black/[0.04] text-text-muted dark:bg-white/[0.06]";
  const label =
    status === "success"
      ? t("Success")
      : status === "failed"
        ? t("Failed")
        : status === "pending"
          ? t("Pending")
          : status === "cancelled"
            ? t("Cancelled")
            : statusLabel || "—";
  return (
    <span className={`${PILL} ${tone}`} title={status === "failed" ? cause || undefined : undefined}>
      {label}
    </span>
  );
}

function AttemptsCell({ row }: { row: RequestRow }) {
  const failed = row.routing?.failed ?? 0;
  const switched = row.routing?.switched ?? 0;
  if (failed === 0 && switched === 0) return <span className="text-text-muted">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {failed > 0 && (
        <span
          title={t("Failed attempts")}
          className="inline-flex items-center gap-0.5 font-mono text-[11px] font-medium text-destructive"
        >
          <X className="size-3" aria-hidden />
          {failed}
        </span>
      )}
      {switched > 0 && (
        <span
          title={t("Account fallback")}
          className={`${PILL} border-warning-border/30 bg-warning/10 text-warning`}
        >
          <ArrowRightLeft className="size-3" aria-hidden />
          {t("fallback")}
        </span>
      )}
    </span>
  );
}

function ModelCell({ row }: { row: RequestRow }) {
  const jump = modelJump(row.routing);
  if (!jump) {
    return <span className="text-text-main">{row.model || row.routing?.selected || row.routing?.requested || "—"}</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-text-muted" title={t("Requested model")}>{jump.from}</span>
      <ArrowRight className="size-3 shrink-0 text-text-muted" aria-hidden />
      <span className="font-medium text-text-main" title={t("Selected model")}>{jump.to}</span>
    </span>
  );
}

interface Props {
  rows: RequestRow[];
  loading: boolean;
  error: boolean;
  pagination: { page: number; pageSize: number; totalItems: number };
  filtersActive: boolean;
  onClearFilters: () => void;
  onRowClick: (row: RequestRow) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

/** Dense, scannable request list: identity first (status, when, which model),
 *  then the mechanics (attempts, fallbacks), then usage. Row = drawer. */
export default function RequestsTable({
  rows, loading, error, pagination, filtersActive, onClearFilters, onRowClick, onPageChange, onPageSizeChange,
}: Props) {
  const openRow = (row: RequestRow) => onRowClick(row);
  return (
    <Card padding="none">
      <Table className="min-w-[1080px]">
        <TableHeader>
          <TableRow>
            <TableHead className={HEAD}>{t("Status")}</TableHead>
            <TableHead className={HEAD}>{t("DateTime")}</TableHead>
            <TableHead className={HEAD}>{t("Model")}</TableHead>
            <TableHead className={HEAD}>{t("Attempts")}</TableHead>
            <TableHead className={`${HEAD} text-right`}>{t("Cost")}</TableHead>
            <TableHead className={`${HEAD} text-right`}>{t("Tokens")}</TableHead>
            <TableHead className={`${HEAD} text-right`}>{t("In")}</TableHead>
            <TableHead className={`${HEAD} text-right`}>{t("Out")}</TableHead>
            <TableHead className={HEAD}>{t("Cache")}</TableHead>
            <TableHead className={`${HEAD} w-10`}>
              <span className="sr-only">{t("Action")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {Array.from({ length: 10 }).map((_, j) => (
                  <TableCell key={j} className={CELL}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : error ? (
            <TableRow>
              <TableCell colSpan={10} className="px-4 py-12 text-center text-sm text-destructive">
                {t("Failed to load requests.")}
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="px-4 py-12 text-center">
                {filtersActive ? (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm text-text-main">{t("No requests match the current filters.")}</p>
                    <Button variant="outline" size="sm" onClick={onClearFilters}>
                      {t("Clear Filters")}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">{t("No requests recorded yet.")}</p>
                )}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const cacheRead = getCachedTokens(row.tokens);
              const cacheWrite = getCacheCreationTokens(row.tokens);
              const total = totalTokens(row);
              const cost = formatCostCell(row.cost);
              return (
                <TableRow
                  key={row.id}
                  tabIndex={0}
                  onClick={() => openRow(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openRow(row);
                    }
                  }}
                  className="cursor-pointer hover:bg-black/[0.02] focus-visible:bg-black/[0.04] focus-visible:outline-none dark:hover:bg-white/[0.02] dark:focus-visible:bg-white/[0.04]"
                >
                  <TableCell className={CELL}>
                    <StatusPill statusLabel={row.statusLabel} cause={row.statusRaw} />
                  </TableCell>
                  <TableCell className={`${CELL} whitespace-nowrap font-mono text-text-main`}>
                    {formatClock(row.timestamp)}{" "}
                    <span className="text-text-muted">{formatShortDate(row.timestamp)}</span>
                  </TableCell>
                  <TableCell className={`${CELL} max-w-[280px] font-mono`}>
                    <ModelCell row={row} />
                  </TableCell>
                  <TableCell className={CELL}>
                    <AttemptsCell row={row} />
                  </TableCell>
                  <TableCell className={`${CELL_NUM} whitespace-nowrap text-text-main`} title={cost.title}>
                    {cost.text}
                  </TableCell>
                  <TableCell className={`${CELL_NUM} font-medium text-text-main`}>
                    {total === null ? "—" : total.toLocaleString()}
                  </TableCell>
                  <TableCell className={`${CELL_NUM} text-text-muted`}>
                    {row.promptTokens === undefined ? "—" : (row.promptTokens || 0).toLocaleString()}
                  </TableCell>
                  <TableCell className={`${CELL_NUM} text-text-muted`}>
                    {row.completionTokens === undefined ? "—" : (row.completionTokens || 0).toLocaleString()}
                  </TableCell>
                  <TableCell className={`${CELL} whitespace-nowrap font-mono text-text-muted`}>
                    {cacheRead > 0 || cacheWrite > 0
                      ? `${t("Read")}: ${cacheRead.toLocaleString()} / ${t("Write")}: ${cacheWrite.toLocaleString()}`
                      : "—"}
                  </TableCell>
                  <TableCell className={`${CELL} text-right`}>
                    <ChevronRight className="size-4 text-text-muted" aria-hidden />
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {!loading && !error && rows.length > 0 && (
        <div className="border-t border-black/5 dark:border-white/5">
          <Pagination
            currentPage={pagination.page}
            pageSize={pagination.pageSize}
            totalItems={pagination.totalItems}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        </div>
      )}
    </Card>
  );
}
