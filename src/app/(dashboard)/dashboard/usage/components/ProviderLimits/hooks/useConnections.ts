"use client";

import { useState, useCallback, useRef } from "react";
import {
  getSafePagination,
  getSafeTotals,
  getProviderOptions,
  getPaginationPageValue,
  CONNECTIONS_PAGE_SIZE,
  type Connection,
  type Pagination,
  type Totals,
} from "../utils";
import type { UseConnectionsReturn } from "../types";

export function useConnections(): UseConnectionsReturn {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(CONNECTIONS_PAGE_SIZE);
  const [customPageSizeInput, setCustomPageSizeInput] = useState(
    String(CONNECTIONS_PAGE_SIZE),
  );
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: CONNECTIONS_PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });
  const [totals, setTotals] = useState({
    eligibleConnections: 0,
    providerFilteredConnections: 0,
  });
  const [providerFilter, setProviderFilter] = useState("all");
  const [providerOptions, setProviderOptions] = useState<string[]>([]);
  const [accountFilter, setAccountFilter] = useState("all");
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);

  // Ref to always have access to the current page without making it a dependency
  const pageRef = useRef(page);
  pageRef.current = page;

  const fetchConnections = useCallback(
    async (targetPage?: number) => {
      const effectivePage = targetPage ?? pageRef.current;
      try {
        const params = new URLSearchParams({
          page: String(effectivePage),
          pageSize: String(pageSize),
          accountStatus: accountFilter,
          sort: "priority",
        });

        if (providerFilter !== "all") {
          params.set("provider", providerFilter);
        }

        const response = await fetch(
          `/api/providers/client?${params.toString()}`,
        );
        if (!response.ok) throw new Error("Failed to fetch connections");

        const data = await response.json() as Record<string, unknown>;
        const connectionList = (data.connections as Connection[]) || [];
        const nextPagination = getSafePagination(data.pagination as Pagination | null, pageSize);
        const nextTotals = getSafeTotals(data.totals as Totals | null, connectionList.length);

        setConnections(connectionList);
        setProviderOptions(getProviderOptions(data.providerOptions as string[] | null));
        setPagination(nextPagination);
        setTotals(nextTotals);
        setPage(getPaginationPageValue(data.pagination as Pagination | null, effectivePage));
        return connectionList;
      } catch (error) {
        console.error("Error fetching connections:", error);
        setConnections([]);
        setProviderOptions([]);
        setPagination({ page: 1, pageSize, total: 0, totalPages: 1 });
        setTotals({ eligibleConnections: 0, providerFilteredConnections: 0 });
        return [];
      }
    },
    [accountFilter, pageSize, providerFilter],
  );

  return {
    connections,
    setConnections,
    providerOptions,
    pagination,
    totals,
    connectionsLoading,
    setConnectionsLoading,
    page,
    setPage,
    pageSize,
    setPageSize,
    customPageSizeInput,
    setCustomPageSizeInput,
    providerFilter,
    setProviderFilter,
    accountFilter,
    setAccountFilter,
    providerMenuOpen,
    setProviderMenuOpen,
    fetchConnections,
  };
}
