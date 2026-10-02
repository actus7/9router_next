"use client";

import { Switch } from "@/components/ui/switch";
import { translate } from "@/i18n/runtime";
import RequestsPanel from "./requests/RequestsPanel";
import useObservability from "./requests/useObservability";

/*
 * Overview counts every request; the list below reads the same summary, so it
 * is always on. This switch governs only the recording of full request and
 * response bodies, which the drawer shows per request. It used to live in
 * Profile, far from the only screen it affects — a request without a recorded
 * body then read as "broken" instead of "not recorded".
 */
export default function RequestDetailsTab() {
  const { settings, observabilityOn, setObservability } = useObservability();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-bg-subtle px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-main">{translate("Enable Observability")}</p>
          <p className="text-xs text-text-muted">
            {translate("Record request details for inspection in the logs view")}
          </p>
        </div>
        <Switch
          checked={observabilityOn}
          onCheckedChange={setObservability}
          disabled={!settings}
          aria-label={translate("Enable Observability") ?? "Enable Observability"}
        />
      </div>
      <RequestsPanel />
    </div>
  );
}
