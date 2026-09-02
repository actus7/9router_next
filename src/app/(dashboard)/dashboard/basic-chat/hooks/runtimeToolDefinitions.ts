import { getRuntimeToolDefinitions } from "@/shared/harness/agentPlugins";

/**
 * Backwards-compatible Standard-mode export. New request paths must resolve
 * definitions from the session composition instead of using this global list.
 */
export const runtimeToolDefinitions = getRuntimeToolDefinitions();
