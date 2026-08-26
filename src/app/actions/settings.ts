"use server";

import { revalidatePath } from "next/cache";
import { settingsRepo } from "@/lib/db/repos/settingsRepo";

export async function updateSetting(key: string, value: unknown) {
  await settingsRepo.updateSettings({ [key]: value });
  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/combos");
}

export async function updateSettings(data: Record<string, unknown>) {
  await settingsRepo.updateSettings(data);
  revalidatePath("/dashboard/profile");
}
