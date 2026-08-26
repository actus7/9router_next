// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  getRecentLogs,
} from "@/lib/db/repos/usageRepo";

export {
  appendRequestLog,
} from "@/lib/db/repos/usageRepo";

export {
  saveRequestDetail, getRequestDetails, getRequestDetailById,
} from "@/lib/db/repos/requestDetailsRepo";
