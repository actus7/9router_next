import { Service } from "cordis";
import type { Context } from "cordis";
import { getExecutor, hasSpecializedExecutor } from "@/server/llm-gateway/engine/executors";
import { registerExecutor } from "../pluginRegistry";

declare module "cordis" {
  interface Context {
    executors: ExecutorsService;
  }
}

export class ExecutorsService extends Service {
  constructor(ctx: Context) {
    super(ctx, "executors");
  }

  get(provider: string): unknown {
    return getExecutor(provider);
  }

  has(provider: string): boolean {
    return hasSpecializedExecutor(provider);
  }

  /** Contribute an executor for `provider`. Takes priority over the static registry for every caller, including ones that never touch Cordis. */
  register(provider: string, executor: unknown): void {
    registerExecutor(provider, executor);
  }
}
