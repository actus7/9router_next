import "server-only";

import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { resolveProviderId } from "@/shared/constants/providers";
import { paramSpecFor, staticTargetFormat, type ParamSpec } from "@/server/llm-gateway/engine/services/modelParams";

export interface ModelParamInfo {
  /** Null when the catalog does not know the model: nothing to configure. */
  spec: ParamSpec | null;
  /** The provider's active accounts, in the order the gateway tries them. */
  connections: Array<{ id: string; label: string }>;
}

/** What the lane entry's parameters dialog and account picker need for one `provider/model` key. */
export async function getModelParamInfo(modelKey: string): Promise<ModelParamInfo> {
  const slash = modelKey.indexOf("/");
  const provider = resolveProviderId(modelKey.slice(0, slash));
  const upstream = modelKey.slice(slash + 1);
  const rows = await getProviderConnections({ provider, isActive: true });
  const connections = rows.map((row, index) => ({
    id: row.id,
    label: String(row.displayName || row.name || row.email || `#${index + 1}`),
  }));
  const oauth = rows.some((row) => row.authType === "oauth");
  return { spec: paramSpecFor(upstream, { subscription: oauth, targetFormat: staticTargetFormat(provider, upstream) }), connections };
}
