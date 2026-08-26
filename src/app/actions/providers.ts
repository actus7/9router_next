"use server";

import { revalidatePath } from "next/cache";
import { connectionsRepo } from "@/lib/db/repos/connectionsRepo";
import { nodesRepo } from "@/lib/db/repos/nodesRepo";

export async function createProvider(data: {
  provider: string;
  authType?: string;
  name?: string;
  email?: string;
  priority?: number;
  isActive?: boolean;
  providerSpecificData?: Record<string, unknown>;
  [key: string]: unknown;
}) {
  const result = await connectionsRepo.createProviderConnection(data);
  revalidatePath("/dashboard/providers");
  return result;
}

export async function updateProvider(id: string, data: Record<string, unknown>) {
  await connectionsRepo.updateProviderConnection(id, data);
  revalidatePath("/dashboard/providers");
  revalidatePath("/dashboard/providers/[id]");
}

export async function deleteProvider(id: string) {
  await connectionsRepo.deleteProviderConnection(id);
  revalidatePath("/dashboard/providers");
}

export async function toggleProvider(id: string, active: boolean) {
  await connectionsRepo.updateProviderConnection(id, { isActive: active });
  revalidatePath("/dashboard/providers");
}

export async function deleteProviderNode(id: string) {
  await nodesRepo.deleteProviderNode(id);
  revalidatePath("/dashboard/media-providers");
}
