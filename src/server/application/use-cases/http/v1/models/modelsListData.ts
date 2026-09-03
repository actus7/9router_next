import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { getCombos } from "@/lib/db/repos/combosRepo";
import { getCustomModels, getModelAliases } from "@/lib/db/repos/aliasRepo";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import type { ConnectionRecord } from "./liveModelResolvers";
import type { ModelsData } from "./modelsListTypes";

/** Fetch all data sources needed to build the models list. */
export async function fetchModelsData(): Promise<ModelsData> {
  let connections: ConnectionRecord[] = [];
  try {
    connections = (await getProviderConnections()) as unknown as ConnectionRecord[];
    connections = connections.filter((c) => c.isActive !== false);
  } catch { console.error("Could not fetch providers, returning all models"); }

  let combos: Record<string, unknown>[] = [];
  try {
    combos = (await getCombos()) as unknown as Record<string, unknown>[];
  } catch { console.error("Could not fetch combos"); }

  let customModels: Record<string, unknown>[] = [];
  try {
    customModels = (await getCustomModels()) as unknown as Record<string, unknown>[];
  } catch { console.error("Could not fetch custom models"); }

  let modelAliases: Record<string, unknown> = {};
  try {
    modelAliases = (await getModelAliases()) as unknown as Record<string, unknown>;
  } catch { console.error("Could not fetch model aliases"); }

  let disabledByAlias: Record<string, string[]> = {};
  try {
    disabledByAlias = (await getDisabledModels()) as unknown as Record<string, string[]>;
  } catch { console.error("Could not fetch disabled models"); }

  return { connections, combos, customModels, modelAliases, disabledByAlias };
}
