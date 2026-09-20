// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, statsEventName, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageStats, getChartData,
  getRecentLogs,
} from "@/lib/db/repos/usageRepo";

export {
  appendRequestLog,
} from "@/lib/db/repos/usageRepo";

export {
  saveRequestDetail, getRequestDetails,
} from "@/lib/db/repos/requestDetailsRepo";

// getRequestDetailById is now exported from requestDetailsRepo
