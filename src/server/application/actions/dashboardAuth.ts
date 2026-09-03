"use server";

import { cookies } from "next/headers";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

export async function assertDashboardSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token || !(await verifyDashboardAuthToken(token))) {
    throw new HttpValidationError("Unauthorized", 401, "UNAUTHORIZED");
  }
}
