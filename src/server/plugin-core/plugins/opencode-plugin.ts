import type { Context } from "cordis";
import type { CorePlugin } from "./registry";
import { OpenCodeExecutor } from "@/server/llm-gateway/engine/executors/opencode";

/**
 * Registers the opencode executor through the plugin overlay instead of the
 * static executors map — proves the plugin-core registration path is wired
 * into the chat hot path (see executors/index.ts). Chosen because opencode
 * authenticates with a public sentinel token (no real account needed), so
 * this plugin is testable end-to-end with zero configured credentials.
 */
export const opencodePlugin: CorePlugin = {
  name: "opencode",
  inject: ["executors"],
  apply(ctx: Context): void {
    ctx.executors.register("opencode", new OpenCodeExecutor());
  },
};
