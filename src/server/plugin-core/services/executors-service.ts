import { Service } from "cordis";
import type { Context } from "cordis";
import { getExecutor, hasSpecializedExecutor } from "@/server/llm-gateway/engine/executors";

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
}
