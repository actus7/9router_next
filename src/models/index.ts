// Database Models - Export from direct repo modules
export {
  getProviderConnections,
  getProviderConnectionById,
  createProviderConnection,
  updateProviderConnection,
  deleteProviderConnection,
  deleteProviderConnectionsByProvider,
  TEST_STATUS_ON_CREDENTIAL_ACQUIRED,
  testStatusForValidation,
  normalizeConnectionTestStatus,
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
} from "@/lib/db/repos/proxyPoolsRepo";
export {
  getModelAliases,
  setModelAlias,
  deleteModelAlias,
  getCustomModels,
  addCustomModel,
  deleteCustomModel,
  syncDiscoveredCustomModels,
  pickDiscoveredMetadata,
} from "@/lib/db/repos/aliasRepo";
export {
  getCloudConnections,
  getCloudConnectionByProvider,
  getCloudConnectionById,
  createCloudConnection,
  deleteCloudConnection,
} from "@/lib/db/repos/cloudConnectionsRepo";
export {
  getCloudDeployments,
  getCloudDeploymentById,
  createCloudDeployment,
  updateCloudDeployment,
  deleteCloudDeployment,
} from "@/lib/db/repos/cloudDeploymentsRepo";
// Cloud deploy mints and revokes its own gateway key, so the deployment routes
// need these. Exposed through this barrel because route handlers must not
// import @/lib/db/repos directly — tests/unit/architectureGates.test.ts.
export {
  issueApiKeyForSink,
  revokeApiKeysForSink,
  type ApiKeySink,
} from "@/lib/db/repos/apiKeysRepo";
