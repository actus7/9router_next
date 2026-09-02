"use client";

import { useState, useEffect, useCallback } from "react";
import useSWR from "swr";
import Drawer from "@/shared/components/Drawer";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import { translate } from "@/i18n/runtime";
import type { RequestDetail } from "./types";
import { fetchProviderNames, getProviderName } from "./providerUtils";
import FilterBar from "./FilterBar";
import RequestTable from "./RequestTable";
import SummaryInfoGrid from "./SummaryInfoGrid";
import PxPipePanel from "./PxPipePanel";
import RoutingPanel from "./RoutingPanel";
import JsonCollapsiblePanel from "./JsonCollapsiblePanel";
import ClientResponsePanel from "./ClientResponsePanel";

export default function RequestDetailsTab() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedDetail, setSelectedDetail] = useState<RequestDetail | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);
  const [providerNameCache, setProviderNameCache] = useState<Record<string, string | { name?: string }> | null>(null);
  const [filters, setFilters] = useState({ provider: "", startDate: "", endDate: "" });

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/providers");
      const data = await res.json();
      setProviders(data.providers || []);
      const cache = await fetchProviderNames();
      setProviderNameCache(cache.providerNameCache);
    } catch (error) {
      console.error("Failed to fetch providers:", error);
    }
  }, []);

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);

  const { data, isLoading: loading } = useSWR<{
    details?: RequestDetail[];
    pagination?: { totalItems?: number };
  }>(`/api/usage/request-details?${params.toString()}`, jsonFetcher);
  const details = data?.details ?? [];
  const totalItems = data?.pagination?.totalItems ?? 0;

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <FilterBar providers={providers} filters={filters} onFiltersChange={setFilters} />
      <RequestTable
        details={details} loading={loading} pagination={{ page, pageSize, totalItems }}
        providerNameCache={providerNameCache}
        onViewDetail={(d) => { setSelectedDetail(d); setIsDrawerOpen(true); }}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />
      <Drawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)}
        title={translate("Request Details") || "Request Details"} width="lg">
        {selectedDetail && (
          <div className="flex flex-col gap-6">
            <SummaryInfoGrid detail={selectedDetail} providerName={getProviderName(selectedDetail.provider, providerNameCache)} />
            {selectedDetail.pxpipe && <PxPipePanel pxpipe={selectedDetail.pxpipe} />}
            <div className="flex flex-col gap-4">
              {selectedDetail.request?.routing && <RoutingPanel routing={selectedDetail.request.routing} />}
              <JsonCollapsiblePanel title={translate("1. Client Request (Input)") || "1. Client Request (Input)"}
                data={selectedDetail.request} defaultOpen={true} icon="input" />
              <JsonCollapsiblePanel title={translate("2. Provider Request (Translated)") || "2. Provider Request (Translated)"}
                data={selectedDetail.providerRequest} icon="translate" />
              <JsonCollapsiblePanel title={translate("3. Provider Response (Raw)") || "3. Provider Response (Raw)"}
                data={selectedDetail.providerResponse} icon="data_object" />
              <ClientResponsePanel thinking={selectedDetail.response?.thinking} content={selectedDetail.response?.content} />
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}


