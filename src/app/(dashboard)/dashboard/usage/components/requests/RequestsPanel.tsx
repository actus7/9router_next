"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import Drawer from "@/shared/components/Drawer";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import { translate } from "@/i18n/runtime";
import { fetchProviderNames } from "../providerUtils";
import RequestsToolbar from "./RequestsToolbar";
import RequestsTable from "./RequestsTable";
import RequestDrawerBody from "./RequestDrawerBody";
import { buildRequestsQuery, hasActiveFilters } from "./requestFormat";
import { findNewRequestIds, LIVE_REFRESH_MS, shouldPollRequests } from "./requestLive";
import { EMPTY_FILTERS, type RequestFilters, type RequestRow, type RequestsResponse } from "./types";

/** The Requests experience: always-on dense list, filters on top, one drawer
 *  per request. Rows come from the usage summary, so the list works even with
 *  observability (body recording) off. */
export default function RequestsPanel() {
  const [filters, setFilters] = useState<RequestFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [live, setLive] = useState(true);
  const [pageSize, setPageSize] = useState(20);
  const [selectedRow, setSelectedRow] = useState<RequestRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [providerNameCache, setProviderNameCache] = useState<Record<string, string | { name?: string }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProviderNames()
      .then(({ providerNameCache: cache }) => {
        if (!cancelled) setProviderNameCache(cache);
      })
      .catch(() => {
        // Friendly names are cosmetic: keep raw provider ids on failure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const query = buildRequestsQuery(filters, page, pageSize);
  const polling = shouldPollRequests({ live, page, drawerOpen });
  const { data, isLoading, error } = useSWR<RequestsResponse>(`/api/usage/requests?${query}`, jsonFetcher, {
    refreshInterval: polling ? LIVE_REFRESH_MS : 0,
    refreshWhenHidden: false,
    keepPreviousData: true,
  });
  const rows = data?.requests ?? [];

  // Rows newer than the last render's newest id flash once; the first load flags nothing.
  const lastSeenId = useRef<number | null>(null);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!data || page !== 1) return;
    const fresh = findNewRequestIds(lastSeenId.current, data.requests);
    const newest = data.requests[0]?.id;
    if (newest !== undefined) lastSeenId.current = Math.max(lastSeenId.current ?? newest, newest);
    setNewIds(fresh);
  }, [data, page]);
  const pagination = data?.pagination ?? { page, pageSize, totalItems: 0 };

  const updateFilters = useCallback((patch: Partial<RequestFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setLive((v) => !v)}
          aria-pressed={polling}
          className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-medium text-text-main hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
        >
          <span
            aria-hidden
            className={`size-2 rounded-full ${polling ? "animate-pulse bg-success" : "bg-text-muted"}`}
          />
          {polling ? translate("Live") || "Live" : translate("Paused") || "Paused"}
        </button>
      </div>
      <RequestsToolbar
        filters={filters}
        onChange={updateFilters}
        filterOptions={data?.filterOptions}
        providerNameCache={providerNameCache}
        totalItems={pagination.totalItems}
      />
      <RequestsTable
        rows={rows}
        newIds={newIds}
        loading={isLoading}
        error={Boolean(error)}
        pagination={pagination}
        filtersActive={hasActiveFilters(filters)}
        onClearFilters={() => updateFilters(EMPTY_FILTERS)}
        onRowClick={(row) => {
          setSelectedRow(row);
          setDrawerOpen(true);
        }}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={translate("Request Details") || "Request Details"}
        width="lg"
        /* The shared Sheet base pins side drawers to 75vw/max-w-sm; these
           important widths win over it and make the drawer full-width on
           narrow screens. */
        className="w-full! max-w-none! sm:w-[640px]! lg:w-[760px]!"
      >
        {drawerOpen && selectedRow ? (
          <RequestDrawerBody row={selectedRow} providerNameCache={providerNameCache} />
        ) : null}
      </Drawer>
    </div>
  );
}
