"use client";

import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import Pagination from "@/shared/components/Pagination";
import { Loader2 } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { RequestDetail } from "./types";
import { getProviderName } from "./providerUtils";
import { getInputTokens, getCachedTokens, getCacheCreationTokens } from "./tokenUtils";

interface Props {
  details: RequestDetail[];
  loading: boolean;
  pagination: { page: number; pageSize: number; totalItems: number };
  providerNameCache: Record<string, string | { name?: string }> | null;
  onViewDetail: (detail: RequestDetail) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function RequestTable({
  details, loading, pagination, providerNameCache, onViewDetail, onPageChange, onPageSizeChange
}: Props) {
  return (
    <Card padding="none">
      <Table className="min-w-[880px]">
        <TableHeader>
          <TableRow>
            <TableHead className="p-4 text-sm font-semibold text-text-main">{translate("DateTime")}</TableHead>
            <TableHead className="p-4 text-sm font-semibold text-text-main">{translate("Model")}</TableHead>
            <TableHead className="p-4 text-sm font-semibold text-text-main">{translate("Provider")}</TableHead>
            <TableHead className="p-4 text-right text-sm font-semibold text-text-main">{translate("Input Tokens")}</TableHead>
            <TableHead className="p-4 text-right text-sm font-semibold text-text-main">{translate("Cached")}</TableHead>
            <TableHead className="p-4 text-right text-sm font-semibold text-text-main">{translate("Cache Creation")}</TableHead>
            <TableHead className="p-4 text-right text-sm font-semibold text-text-main">{translate("Output Tokens")}</TableHead>
            <TableHead className="p-4 text-sm font-semibold text-text-main">{translate("Latency")}</TableHead>
            <TableHead className="p-4 text-center text-sm font-semibold text-text-main">{translate("Action")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={7} className="p-8 text-center text-text-muted">
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="size-5" />{translate("Loading...")}
                </div>
              </TableCell>
            </TableRow>
          ) : details.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="p-8 text-center text-text-muted">
                {translate("No request details found")}
              </TableCell>
            </TableRow>
          ) : (
            details.map((detail, index) => (
              <TableRow key={`${detail.id}-${index}`} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                <TableCell className="p-4 text-sm text-text-main">
                  {new Date(detail.timestamp).toLocaleString()}
                </TableCell>
                <TableCell className="max-w-[260px] truncate p-4 font-mono text-sm text-text-main">
                  {detail.model}
                </TableCell>
                <TableCell className="max-w-[180px] truncate p-4 text-sm text-text-main">
                  <span className="font-medium">{getProviderName(detail.provider, providerNameCache)}</span>
                </TableCell>
                <TableCell className="p-4 text-sm text-text-main text-right font-mono">
                  {getInputTokens(detail.tokens).toLocaleString()}
                </TableCell>
                <TableCell className="p-4 text-sm text-text-main text-right font-mono">
                  {getCachedTokens(detail.tokens) > 0 ? getCachedTokens(detail.tokens).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="p-4 text-sm text-text-main text-right font-mono">
                  {getCacheCreationTokens(detail.tokens) > 0 ? getCacheCreationTokens(detail.tokens).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="p-4 text-sm text-text-main text-right font-mono">
                  {detail.tokens?.completion_tokens?.toLocaleString() || 0}
                </TableCell>
                <TableCell className="p-4 text-sm text-text-muted">
                  <div className="flex flex-col gap-0.5">
                    <div>TTFT: <span className="font-mono">{detail.latency?.ttft || 0}ms</span></div>
                    <div>Total: <span className="font-mono">{detail.latency?.total || 0}ms</span></div>
                  </div>
                </TableCell>
                <TableCell className="p-4 text-center">
                  <Button variant="outline" size="sm" onClick={() => onViewDetail(detail)}>
                    {translate("Details")}
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {!loading && details.length > 0 && (
        <div className="border-t border-black/5 dark:border-white/5">
          <Pagination currentPage={pagination.page} pageSize={pagination.pageSize}
            totalItems={pagination.totalItems} onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange} />
        </div>
      )}
    </Card>
  );
}
