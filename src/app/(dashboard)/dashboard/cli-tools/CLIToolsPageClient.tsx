"use client";

import { useState, useEffect } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import ToolSummaryCard from "./components/ToolSummaryCard";
import { translate } from "@/i18n/runtime";

const ALL_STATUSES_URL = "/api/cli-tools/all-statuses";

interface CLIToolsPageClientProps {
  machineId: string;
}

interface ToolStatuses {
  [toolId: string]: Record<string, unknown>;
}

export default function CLIToolsPageClient({ machineId: _machineId }: CLIToolsPageClientProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [toolStatuses, setToolStatuses] = useState<ToolStatuses>({});
  // The server answers 403 when this dashboard is opened over the network: the
  // tools live on the machine running ModelHub, and only it may touch them.
  const [remote, setRemote] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(ALL_STATUSES_URL);
        if (res.ok && mounted) setToolStatuses(await res.json());
        if (res.status === 403 && mounted) setRemote(true);
      } catch (error) {
        console.error("Error fetching tool statuses:", error);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const regularTools = Object.entries(CLI_TOOLS);

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {remote && (
        <p role="status" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-text-muted">
          {translate("CLI Tools configures the tools installed on the machine running ModelHub. Open this dashboard on that machine (localhost) to read or change them.")}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {regularTools.map(([toolId, tool]) => (
          <ToolSummaryCard key={toolId} toolId={toolId} tool={tool} status={toolStatuses[toolId]} />
        ))}
      </div>
    </div>
  );
}
