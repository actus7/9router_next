import { Context } from "cordis";

let rootContext: Context | null = null;

export function bootstrap(): Context {
  if (!rootContext) {
    rootContext = new Context();
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
