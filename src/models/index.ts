// Database Models - Export from direct repo modules
export {
  getProviderConnections,
  getProviderConnectionById,
  createProviderConnection,
  updateProviderConnection,
  setProviderConnectionsActive,
  deleteProviderConnection,
  deleteProviderConnectionsByProvider,
  TEST_STATUS_ON_CREDENTIAL_ACQUIRED,
} from "@/lib/db/repos/connectionsRepo";
export {
  getProviderNodes,
  getProviderNodeById,
  createProviderNode,
  updateProviderNode,
  deleteProviderNode,
} from "@/lib/db/repos/nodesRepo";
export {
  getProxyPools,
  getProxyPoolById,
  createProxyPool,
  updateProxyPool,
  deleteProxyPool,
  setProxyPoolsActive,
  deleteProxyPools,
} from "@/lib/db/repos/proxyPoolsRepo";
export {
  getModelAliases,
  setModelAlias,
  deleteModelAlias,
  getCustomModels,
  addCustomModel,
  deleteCustomModel,
  deleteCustomModelsByProvider,
  deleteModelAliasesByProvider,
  syncDiscoveredCustomModels,
  pickDiscoveredMetadata,
  discoveredModelKind,
} from "@/lib/db/repos/aliasRepo";
