"use server";

import { revalidatePath } from "next/cache";
import { apiKeysRepo } from "@/lib/db/repos/apiKeysRepo";

export async function createKey(name: string, machineId: string) {
  const result = await apiKeysRepo.createApiKey(name, machineId);
  revalidatePath("/dashboard/endpoint");
  return result;
}

export async function deleteKey(id: string) {
  await apiKeysRepo.deleteApiKey(id);
  revalidatePath("/dashboard/endpoint");
}
