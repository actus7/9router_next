// Host adapter — local database reads/writes (connections, custom models,
// combos, smart-routing profiles, disabled models).
//
// The engine must not import @/lib/localDb or @/lib/disabledModelsDb
// directly; this module enumerates exactly which host state the engine
// touches. Swap with in-memory fakes in tests (see tests/unit/hostSeam.test.ts).
export {
  getCustomModels,
  getProviderConnections,
  getSmartModelProfiles,
  upsertSmartModelProfiles,
  getComboByName,
} from "@/lib/localDb";
export { getDisabledModels } from "@/lib/disabledModelsDb";
