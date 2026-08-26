"use server";

import { revalidatePath } from "next/cache";
import { proxyPoolsRepo } from "@/lib/db/repos/proxyPoolsRepo";

export async function createPool(data: Record<string, unknown>) {
  const result = await proxyPoolsRepo.createProxyPool(data);
  revalidatePath("/dashboard/proxy-pools");
  return result;
}

export async function updatePool(id: string, data: Record<string, unknown>) {
  await proxyPoolsRepo.updateProxyPool(id, data);
  revalidatePath("/dashboard/proxy-pools");
}

export async function deletePool(id: string) {
  await proxyPoolsRepo.deleteProxyPool(id);
  revalidatePath("/dashboard/proxy-pools");
}
