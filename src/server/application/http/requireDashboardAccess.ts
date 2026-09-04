import { NextResponse } from "next/server";
import { hasDashboardAccess } from "@/lib/auth/dashboardAccess";

/**
 * Gate for routes that act with the dashboard owner's authority — running
 * sandboxed code, editing agent memory, toggling plugins, installing skills.
 *
 * Returns the 401 to hand straight back, or null when the caller may proceed.
 */
export async function requireDashboardAccess(): Promise<NextResponse | null> {
  if (await hasDashboardAccess()) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
