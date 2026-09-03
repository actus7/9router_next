"use server";

import { revalidatePath } from "next/cache";
import { HttpValidationError, requireStringField } from "@/server/application/http/requestBody";
import { assertDashboardSession } from "@/server/application/actions/dashboardAuth";
import { createCombo, deleteCombo, updateCombo } from "@/lib/db/repos/combosRepo";

export async function createComboAction(input: {
  name: string;
  models: string[];
  kind?: string;
}): Promise<{ id: string }> {
  await assertDashboardSession();
  const name = requireStringField(input, "name");
  const models = Array.isArray(input.models)
    ? input.models.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
    : [];
  if (models.length === 0) {
    throw new HttpValidationError("At least one model is required", 400, "VALIDATION_ERROR");
  }
  const combo = await createCombo({ name, models, kind: input.kind });
  revalidatePath("/dashboard/combos");
  return { id: combo.id };
}

export async function updateComboAction(
  id: string,
  input: { name?: string; models?: string[]; kind?: string },
): Promise<{ ok: true }> {
  await assertDashboardSession();
  const comboId = requireStringField({ id }, "id");
  const patch: { name?: string; models?: string[]; kind?: string } = {};
  if (input.name !== undefined) patch.name = requireStringField(input, "name");
  if (input.models !== undefined) {
    patch.models = input.models.filter((m): m is string => typeof m === "string" && m.trim().length > 0);
    if (patch.models.length === 0) {
      throw new HttpValidationError("At least one model is required", 400, "VALIDATION_ERROR");
    }
  }
  if (input.kind !== undefined) patch.kind = input.kind;
  const updated = await updateCombo(comboId, patch);
  if (!updated) throw new HttpValidationError("Combo not found", 404, "NOT_FOUND");
  revalidatePath("/dashboard/combos");
  revalidatePath(`/dashboard/combos/${comboId}`);
  return { ok: true };
}

export async function deleteComboAction(id: string): Promise<{ ok: true }> {
  await assertDashboardSession();
  const comboId = requireStringField({ id }, "id");
  const deleted = await deleteCombo(comboId);
  if (!deleted) throw new HttpValidationError("Combo not found", 404, "NOT_FOUND");
  revalidatePath("/dashboard/combos");
  return { ok: true };
}
