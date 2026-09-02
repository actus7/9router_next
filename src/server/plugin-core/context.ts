import { Context } from "cordis";
import { executorsPlugin } from "./plugins/executors-plugin";
import { providersPlugin } from "./plugins/providers-plugin";
import { corePlugins } from "./plugins/registry";

let rootContext: Context | null = null;
let booting: Promise<Context> | null = null;

export function bootstrap(): Promise<Context> {
  booting ??= (async () => {
    const ctx = new Context();
    // executorsPlugin/providersPlugin are the base services every other
    // plugin depends on (ctx.executors, ctx.providers) — they load first.
    await ctx.plugin(executorsPlugin);
    await ctx.plugin(providersPlugin);
    for (const plugin of corePlugins) {
      await ctx.plugin(plugin);
    }
    rootContext = ctx;
    return ctx;
  })().catch((err) => {
    booting = null; // don't cache a poisoned boot attempt
    throw err;
  });
  return booting;
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
  booting = null;
}

export type { Context };
