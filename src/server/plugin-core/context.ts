import { Context } from "cordis";
import { executorsPlugin } from "./plugins/executors-plugin";
import { providersPlugin } from "./plugins/providers-plugin";

let rootContext: Context | null = null;

export async function bootstrap(): Promise<Context> {
  if (!rootContext) {
    const ctx = new Context();
    await ctx.plugin(executorsPlugin);
    await ctx.plugin(providersPlugin);
    rootContext = ctx;
  }
  return rootContext;
}

export function getContext(): Context {
  if (!rootContext) {
    throw new Error("plugin-core: call bootstrap() before getContext()");
  }
  return rootContext;
}

export async function resetContext(): Promise<void> {
  if (rootContext) {
    await rootContext.fiber.dispose();
    rootContext = null;
  }
}

export type { Context };
