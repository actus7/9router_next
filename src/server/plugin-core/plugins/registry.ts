import type { Context } from "cordis";
import { opencodePlugin } from "./opencode-plugin";

export interface CorePlugin {
  name: string;
  /** Cordis services (e.g. "executors", "providers") this plugin reads from `ctx`. */
  inject?: string[];
  apply(ctx: Context): void | Promise<void>;
}

// Additional plugins loaded after the base executors/providers services, in
// order. A plugin is a static module — no filesystem discovery, since a
// bundled serverless function can't reliably scan a plugins directory at
// runtime. To add one: write `{ name, apply(ctx) { ctx.executors.register(...) } }`
// in its own file under this directory, import it here, and list it below.
export const corePlugins: CorePlugin[] = [opencodePlugin];
