"use server";

import { revalidatePath } from "next/cache";
import { HttpValidationError, parseJsonBody } from "@/server/application/http/requestBody";
import { assertDashboardSession } from "@/server/application/actions/dashboardAuth";
import { updateSettings } from "@/lib/db/repos/settingsRepo";

export async function updateDashboardSettingsAction(request: Request): Promise<{ ok: true }> {
  await assertDashboardSession();
  const body = await parseJsonBody<Record<string, unknown>>(request as never);
  if (Object.keys(body).length === 0) {
    throw new HttpValidationError("No settings provided", 400, "VALIDATION_ERROR");
  }
  await updateSettings(body);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/profile");
  return { ok: true };
}
