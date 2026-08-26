// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  getDisabledModels, disableModels, enableModels,
} from "@/lib/db/index";
