"use server";

import { HttpValidationError } from "@/server/application/http/requestBody";
import { hasDashboardAccess } from "@/lib/auth/dashboardAccess";

export async function assertDashboardSession(): Promise<void> {
  if (!(await hasDashboardAccess())) {
    throw new HttpValidationError("Unauthorized", 401, "UNAUTHORIZED");
  }
}
