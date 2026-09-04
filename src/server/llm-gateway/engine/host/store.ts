// Host adapter — local database reads/writes (connections, custom models,
// combos, smart-routing profiles, disabled models).
//
// This module enumerates exactly which host state the engine
// touches. Swap with in-memory fakes in tests (see tests/unit/hostSeam.test.ts).
export { getCustomModels } from "@/lib/db/repos/aliasRepo";
export { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
export { getComboByName } from "@/lib/db/repos/combosRepo";
export {
  getSmartModelProfiles,
  upsertSmartModelProfiles,
} from "@/lib/db/repos/smartModelProfilesRepo";
export { getDisabledModels } from "@/lib/disabledModelsDb";
export { getPricingOverrides } from "@/lib/db/repos/pricingRepo";
