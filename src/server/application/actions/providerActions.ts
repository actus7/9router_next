"use server";

import { revalidatePath } from "next/cache";
import { HttpValidationError, requireStringField } from "@/server/application/http/requestBody";
import { assertDashboardSession } from "@/server/application/actions/dashboardAuth";
import {
  createProviderConnection,
  deleteProviderConnection,
  updateProviderConnection,
} from "@/lib/db/repos/connectionsRepo";

export async function createProviderConnectionAction(input: {
  provider: string;
  name?: string;
  apiKey?: string;
  priority?: number;
}): Promise<{ id: string }> {
  await assertDashboardSession();
  const provider = requireStringField(input, "provider");
  const connection = await createProviderConnection({
    provider,
    name: input.name,
    apiKey: input.apiKey,
    priority: input.priority,
  });
  if (!connection?.id) {
    throw new HttpValidationError("Failed to create connection", 500, "INTERNAL_ERROR");
  }
  revalidatePath("/dashboard/providers");
  revalidatePath(`/dashboard/providers/${provider}`);
  return { id: connection.id };
}

export async function updateProviderConnectionAction(
  id: string,
  input: Record<string, unknown>,
): Promise<{ ok: true }> {
  await assertDashboardSession();
  const connectionId = requireStringField({ id }, "id");
  const updated = await updateProviderConnection(connectionId, input);
  if (!updated) throw new HttpValidationError("Connection not found", 404, "NOT_FOUND");
  revalidatePath("/dashboard/providers");
  if (updated.provider) revalidatePath(`/dashboard/providers/${updated.provider}`);
  return { ok: true };
}

export async function deleteProviderConnectionAction(id: string): Promise<{ ok: true }> {
  await assertDashboardSession();
  const connectionId = requireStringField({ id }, "id");
  const deleted = await deleteProviderConnection(connectionId);
  if (!deleted) throw new HttpValidationError("Connection not found", 404, "NOT_FOUND");
  revalidatePath("/dashboard/providers");
  return { ok: true };
}
