"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import Card from "@/shared/components/Card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ChevronRight } from "lucide-react";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

function fmtTime(iso) {
  if (!iso) return "Never";
  const diffMins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

interface SortIconProps {
  field: string;
  currentSort: string;
  currentOrder: string;
}

function SortIcon({ field, currentSort, currentOrder }: SortIconProps) {
  if (currentSort !== field) return <span className="ml-1 opacity-20">↕</span>;
  return <span className="ml-1">{currentOrder === "asc" ? "↑" : "↓"}</span>;
}

interface ValueCellsProps {
  item: Record<string, unknown>;
  viewMode: string;
  isSummary?: boolean;
}

/**
 * Render 3 token or cost cells based on viewMode
 */
function ValueCells({ item, viewMode, isSummary = false }: ValueCellsProps) {
  if (viewMode === "tokens") {
    return (
      <>
        <TableCell className="px-6 py-3 text-right text-text-muted">
          {isSummary && item.promptTokens === undefined ? "—" : fmt(item.promptTokens)}
        </TableCell>
        <TableCell className="px-6 py-3 text-right text-text-muted">
          {item.cachedTokens ? fmt(item.cachedTokens) : "—"}
        </TableCell>
        <TableCell className="px-6 py-3 text-right text-text-muted">
          {isSummary && item.completionTokens === undefined ? "—" : fmt(item.completionTokens)}
        </TableCell>
        <TableCell className="px-6 py-3 text-right font-medium">
          {fmt(item.totalTokens)}
        </TableCell>
      </>
    );
  }
  return (
    <>
      <TableCell className="px-6 py-3 text-right text-text-muted">
        {isSummary && item.inputCost === undefined ? "—" : fmtCost(item.inputCost)}
      </TableCell>
      <TableCell className="px-6 py-3 text-right text-text-muted">
        {item.cachedCost ? fmtCost(item.cachedCost) : "—"}
      </TableCell>
      <TableCell className="px-6 py-3 text-right text-text-muted">
        {isSummary && item.outputCost === undefined ? "—" : fmtCost(item.outputCost)}
      </TableCell>
      <TableCell className="px-6 py-3 text-right font-medium text-warning">
        {fmtCost(item.totalCost || item.cost)}
      </TableCell>
    </>
  );
}

interface Column {
  field: string;
  label: string;
  align?: string;
}

interface GroupedItem {
  groupKey: string;
  summary: Record<string, unknown>;
  items: Array<Record<string, unknown> & { key: string }>;
}

interface UsageTableProps {
  title: string;
  columns: Column[];
  groupedData: GroupedItem[];
  tableType: string;
  sortBy: string;
  sortOrder: string;
  onToggleSort: (tableType: string, field: string) => void;
  viewMode: string;
  storageKey: string;
  renderDetailCells: (item: Record<string, unknown>) => React.ReactNode;
  renderSummaryCells: (group: GroupedItem) => React.ReactNode;
  emptyMessage: string;
}

export default function UsageTable({
  title,
  columns,
  groupedData,
  tableType,
  sortBy,
  sortOrder,
  onToggleSort,
  viewMode,
  storageKey,
  renderDetailCells,
  renderSummaryCells,
  emptyMessage,
}: UsageTableProps) {
  const [expanded, setExpanded] = useState(new Set());

  // Load expanded state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setExpanded(new Set(JSON.parse(saved)));
    } catch (e) {
      console.error(`Failed to load ${storageKey}:`, e);
    }
  }, [storageKey]);

  // Save expanded state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...expanded]));
    } catch (e) {
      console.error(`Failed to save ${storageKey}:`, e);
    }
  }, [expanded, storageKey]);

  const toggleGroup = useCallback((groupKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
      return next;
    });
  }, []);

  const valueColumns = useMemo(() => {
    if (viewMode === "tokens") {
      return [
        { field: "promptTokens", label: "Input Tokens" },
        { field: "cachedTokens", label: "Cached" },
        { field: "completionTokens", label: "Output Tokens" },
        { field: "totalTokens", label: "Total Tokens" },
      ];
    }
    return [
      { field: "promptTokens", label: "Input Cost" },
      { field: "cachedCost", label: "Cached Cost" },
      { field: "completionTokens", label: "Output Cost" },
      { field: "cost", label: "Total Cost" },
    ];
  }, [viewMode]);

  const totalColSpan = columns.length + valueColumns.length;

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-border bg-bg-subtle/50">
        <h3 className="font-semibold">{title}</h3>
      </div>
        <Table>
          <TableHeader className="bg-bg-subtle/30 text-text-muted uppercase text-xs">
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.field}
                  className={`px-6 py-3 cursor-pointer hover:bg-bg-subtle/50 ${col.align === "right" ? "text-right" : ""}`}
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  {col.label}{" "}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </TableHead>
              ))}
              {valueColumns.map((col) => (
                <TableHead
                  key={col.field}
                  className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  {col.label}{" "}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupedData.map((group) => (
              <Fragment key={group.groupKey}>
                {/* Group summary row */}
                <TableRow
                  className="group-summary cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleGroup(group.groupKey)}
                >
                  <TableCell className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <ChevronRight className={`size-[18px] text-text-muted transition-transform ${expanded.has(group.groupKey) ? "rotate-90" : ""}`} />
                      <span className={`font-medium transition-colors ${group.summary.pending > 0 ? "text-primary" : ""}`}>
                        {group.groupKey}
                      </span>
                    </div>
                  </TableCell>
                  {renderSummaryCells(group)}
                  <ValueCells item={group.summary} viewMode={viewMode} isSummary />
                </TableRow>
                {/* Detail rows */}
                {expanded.has(group.groupKey) && group.items.map((item) => (
                  <TableRow
                    key={`detail-${item.key}`}
                    className="group-detail hover:bg-bg-subtle/20"
                  >
                    {renderDetailCells(item)}
                    <ValueCells item={item} viewMode={viewMode} />
                  </TableRow>
                ))}
              </Fragment>
            ))}
            {groupedData.length === 0 && (
              <TableRow>
                <TableCell colSpan={totalColSpan} className="px-6 py-8 text-center text-text-muted">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
    </Card>
  );
}

// Re-export utilities for use in UsageStats orchestrator
export { fmt, fmtTime };
