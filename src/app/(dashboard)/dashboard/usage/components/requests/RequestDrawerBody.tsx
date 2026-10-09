"use client";

import useSWR from "swr";
import { Loader2 } from "lucide-react";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import { translate } from "@/i18n/runtime";
import SummaryInfoGrid from "../SummaryInfoGrid";
import PxPipePanel from "../PxPipePanel";
import JsonCollapsiblePanel from "../JsonCollapsiblePanel";
import ClientResponsePanel from "../ClientResponsePanel";
import { getProviderName } from "../providerUtils";
import { normalizeRequestDetail } from "./requestFormat";
import RequestFallbackDrawer from "./RequestFallbackDrawer";
import RequestRoutingStory from "./RequestRoutingStory";
import type { RequestRow } from "./types";

function t(text: string): string {
  return translate(text) || text;
}

interface Props {
  row: RequestRow;
  providerNameCache: Record<string, string | { name?: string }> | null;
}

/**
 * Drawer body for one request, in reading order: who answered and what it
 * cost, how routing got there, the answer itself, and only then the raw bodies
 * (closed) for whoever is debugging. Falls back to the list-row view when
 * observability did not record the bodies.
 */
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
        {t("Loading...")}
      </div>
    );
  }

  if (!detail) return <RequestFallbackDrawer row={row} providerNameCache={providerNameCache} />;

  return (
    <div className="flex flex-col gap-6">
      <SummaryInfoGrid
        detail={detail}
        providerName={getProviderName(detail.provider || row.provider || "", providerNameCache)}
        cost={row.cost}
      />
      <RequestRoutingStory routing={row.routing} decision={detail.request?.routing} providerNames={providerNameCache} />
      {detail.pxpipe && <PxPipePanel pxpipe={detail.pxpipe} />}
      <ClientResponsePanel thinking={detail.response?.thinking} content={detail.response?.content} />
      <section aria-label={t("Technical data")} className="flex flex-col gap-3">
        <div>
          <h4 className="text-sm font-semibold text-text-main">{t("Technical data")}</h4>
          <p className="text-xs text-text-muted">{t("The bodies exactly as they were exchanged, for debugging.")}</p>
        </div>
        <JsonCollapsiblePanel title={t("Client request")} data={detail.request} icon="input" />
        <JsonCollapsiblePanel title={t("Request sent to the provider (translated)")} data={detail.providerRequest} icon="translate" />
        <JsonCollapsiblePanel title={t("Provider response (raw)")} data={detail.providerResponse} icon="data_object" />
      </section>
    </div>
  );
}
