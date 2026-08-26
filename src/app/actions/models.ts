"use server";

import { revalidatePath } from "next/cache";
import { disabledModelsRepo } from "@/lib/db/repos/disabledModelsRepo";
import { aliasRepo } from "@/lib/db/repos/aliasRepo";

export async function disableModel(provider: string, model: string) {
  await disabledModelsRepo.disableModels(provider, [model]);
  revalidatePath("/dashboard/providers/[id]");
}

export async function enableModel(provider: string, model: string) {
  await disabledModelsRepo.enableModels(provider, [model]);
  revalidatePath("/dashboard/providers/[id]");
}

export async function createAlias(alias: string, model: string) {
  await aliasRepo.setModelAlias(alias, model);
  revalidatePath("/dashboard/providers/[id]");
}

export async function deleteAlias(alias: string) {
  await aliasRepo.deleteModelAlias(alias);
  revalidatePath("/dashboard/providers/[id]");
}
