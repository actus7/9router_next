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
  saveRequestDetail, getRequestDetails, getDistinctProviders,
} from "@/lib/db/repos/requestDetailsRepo";

// getRequestDetailById is now exported from requestDetailsRepo
export { getRequestDetailById } from "@/lib/db/repos/requestDetailsRepo";
