import { NextRequest, NextResponse } from "next/server";

import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import {
  isUsageRequestRange,
  listUsageRequests,
  USAGE_REQUEST_RANGES,
  type ListUsageRequestsOptions,
  type UsageRequestStatusLabel,
} from "@/server/application/use-cases/usage/listUsageRequests";

/**
 * GET /api/usage/requests
 * The always-on Requests list (one `usageHistory` row per request).
 *
 * Query parameters:
 * - page (default 1), pageSize (default 20, max 100)
 * - status: success | failed ("ok"/empty/"success" rows vs. everything else)
 * - model, provider: exact-name equality filters (provider=__modelhub__: only requests that went through a combo)
 * - apiKey: an `apiKeys.id`
 * - range: 24h | 7d | 30d | 90d | 365d
 * - fallback=true: only rows that switched away from the requested model
 * - hasFailed=true: only rows whose routing recorded model-level failures
 * - includeFilterOptions=1: also answer distinct providers/models
 */
export async function GET(request: NextRequest) {
  // Opt out before the try block: reading `request.url` inside it makes Next
  // throw to interrupt the prerender, and the catch would turn that signal
  // into a 500.
  await assertRequestRuntime();
  const { searchParams } = new URL(request.url);
  try {
    const pageRaw = parseInt(searchParams.get("page") ?? "");
    const page = Number.isNaN(pageRaw) ? 1 : pageRaw;
    const pageSizeRaw = parseInt(searchParams.get("pageSize") ?? "");
    const pageSize = Number.isNaN(pageSizeRaw) ? 20 : pageSizeRaw;

    if (page < 1) {
      return NextResponse.json({ error: "Page must be >= 1" }, { status: 400 });
    }
    if (pageSize < 1 || pageSize > 100) {
      return NextResponse.json({ error: "PageSize must be between 1 and 100" }, { status: 400 });
    }

    const status = searchParams.get("status");
    if (status !== null && status !== "success" && status !== "failed") {
      return NextResponse.json({ error: "Status must be success or failed" }, { status: 400 });
    }

    const range = searchParams.get("range");
    if (range !== null && !isUsageRequestRange(range)) {
      return NextResponse.json(
        { error: `Range must be one of: ${Object.keys(USAGE_REQUEST_RANGES).join(", ")}` },
        { status: 400 },
      );
    }

    const options: ListUsageRequestsOptions = {
      page,
      pageSize,
      status: (status as UsageRequestStatusLabel | null) ?? undefined,
      model: searchParams.get("model") || undefined,
      provider: searchParams.get("provider") || undefined,
      apiKey: searchParams.get("apiKey") || undefined,
      range: range === null ? undefined : range,
      fallback: searchParams.get("fallback") === "true",
      hasFailed: searchParams.get("hasFailed") === "true",
      includeFilterOptions: ["1", "true"].includes(searchParams.get("includeFilterOptions") ?? ""),
    };

    return NextResponse.json(await listUsageRequests(options));
  } catch (error) {
    console.error("[API] Failed to list usage requests:", error);
    return NextResponse.json({ error: "Failed to list usage requests" }, { status: 500 });
  }
}
