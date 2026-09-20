import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { getCombos } from "@/lib/db/repos/combosRepo";
import { getCustomModels, getModelAliases } from "@/lib/db/repos/aliasRepo";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import type { ConnectionRecord } from "./liveModelResolvers";
import type { ModelsData } from "./modelsListTypes";

/** Fetch all data sources needed to build the models list. */
export async function fetchModelsData(): Promise<ModelsData> {
  // Cinco tabelas distintas e nenhuma leitura consome o resultado de outra: em
  // série eram cinco round-trips ao Neon no caminho quente de `GET /v1/models`.
  // O `.catch` por chamada mantém o isolamento de falha que os try/catch davam —
  // um repo indisponível degrada só a própria fatia da resposta.
  const [connections, combos, customModels, modelAliases, disabledByAlias] = await Promise.all([
    // O filtro fica dentro da cadeia, antes do `.catch`: no `try/catch`
    // original ele estava coberto junto com a leitura, e deixá-lo no `return`
    // faria uma falha dele derrubar as outras quatro fatias já resolvidas.
    getProviderConnections()
      .then((rows) => (rows as unknown as ConnectionRecord[]).filter((c) => c.isActive !== false))
      .catch(() => {
        console.error("Could not fetch providers, listing keyless providers only");
        return [] as ConnectionRecord[];
      }),
    getCombos().catch(() => { console.error("Could not fetch combos"); return []; }),
    getCustomModels().catch(() => { console.error("Could not fetch custom models"); return []; }),
    getModelAliases().catch(() => { console.error("Could not fetch model aliases"); return {}; }),
    getDisabledModels().catch(() => { console.error("Could not fetch disabled models"); return {}; }),
  ]);

  return {
    connections: (connections as unknown as ConnectionRecord[]).filter((c) => c.isActive !== false),
    combos: combos as unknown as Record<string, unknown>[],
    customModels: customModels as unknown as Record<string, unknown>[],
    modelAliases: modelAliases as unknown as Record<string, unknown>,
    disabledByAlias: disabledByAlias as unknown as Record<string, string[]>,
  };
}
