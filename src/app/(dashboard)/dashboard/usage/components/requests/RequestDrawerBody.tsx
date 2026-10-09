"use client";

import useSWR from "swr";
import { Loader2 } from "lucide-react";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import { translate } from "@/i18n/runtime";
import SummaryInfoGrid from "../SummaryInfoGrid";
import RoutingPanel from "../RoutingPanel";
import PxPipePanel from "../PxPipePanel";
import JsonCollapsiblePanel from "../JsonCollapsiblePanel";
import ClientResponsePanel from "../ClientResponsePanel";
import { getProviderName } from "../providerUtils";
import { normalizeRequestDetail } from "./requestFormat";
import RequestFallbackDrawer from "./RequestFallbackDrawer";
import RequestRoutingStory from "./RequestRoutingStory";
import type { RequestRow } from "./types";

interface Props {
  row: RequestRow;
  providerNameCache: Record<string, string | { name?: string }> | null;
}

/** Drawer body for one request: the recorded bodies when observability wrote
 *  them, otherwise the self-contained fallback built from the list row. */
export default function RequestDrawerBody({ row, providerNameCache }: Props) {
  const { data, error, isLoading } = useSWR<unknown>(
    `/api/usage/request-details?usageId=${row.id}`,
    jsonFetcher,
  );
  const detail = normalizeRequestDetail(data);

  if (isLoading && !data && !error) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-muted">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        {translate("Loading...") || "Loading..."}
      </div>
    );
  }

  if (!detail) return <RequestFallbackDrawer row={row} providerNameCache={providerNameCache} />;

  return (
    <div className="flex flex-col gap-6">
      <SummaryInfoGrid
        detail={detail}
        providerName={getProviderName(detail.provider || row.provider || "", providerNameCache)}
      />
      <RequestRoutingStory routing={row.routing} />
      {detail.request?.routing && <RoutingPanel routing={detail.request.routing} />}
      {detail.pxpipe && <PxPipePanel pxpipe={detail.pxpipe} />}
      <div className="flex flex-col gap-4">
        <JsonCollapsiblePanel
          title={translate("1. Client Request (Input)") || "1. Client Request (Input)"}
          data={detail.request}
          defaultOpen={true}
          icon="input"
        />
        <JsonCollapsiblePanel
          title={translate("2. Provider Request (Translated)") || "2. Provider Request (Translated)"}
          data={detail.providerRequest}
          icon="translate"
        />
        <JsonCollapsiblePanel
          title={translate("3. Provider Response (Raw)") || "3. Provider Response (Raw)"}
          data={detail.providerResponse}
          icon="data_object"
        />
        <ClientResponsePanel thinking={detail.response?.thinking} content={detail.response?.content} />
      </div>
    </div>
  );
}
