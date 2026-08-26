"use server";

import { revalidatePath } from "next/cache";
import { combosRepo } from "@/lib/db/repos/combosRepo";

export async function createCombo(data: { name: string; kind?: string | null; models?: unknown[] }) {
  const result = await combosRepo.createCombo(data);
  revalidatePath("/dashboard/combos");
  return result;
}

export async function updateCombo(id: string, data: Record<string, unknown>) {
  await combosRepo.updateCombo(id, data);
  revalidatePath("/dashboard/combos");
}

export async function deleteCombo(id: string) {
  await combosRepo.deleteCombo(id);
  revalidatePath("/dashboard/combos");
}
