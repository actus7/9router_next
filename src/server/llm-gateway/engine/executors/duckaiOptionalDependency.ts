// Dynamic import with string indirection to avoid TS module resolution + bundler
// static analysis for optional deps. Falls back to createRequire for runtimes
// where the ESM loader is not wired into the JS context (vitest vm runner,
// some bundler sandboxes — "A dynamic import callback was not specified").
let optionalDepRequire: ((s: string) => unknown) | null = null;
export async function dynamicImport(specifier: string): Promise<unknown> {
  try {
    return await new Function("s", "return import(s)")(specifier);
  } catch {
    // fall through to the require-based strategy
  }
  try {
    if (!optionalDepRequire) {
      const { createRequire } = await import("node:module");
      const { pathToFileURL } = await import("node:url");
      optionalDepRequire = createRequire(pathToFileURL(`${process.cwd()}/package.json`).href) as (s: string) => unknown;
    }
    return optionalDepRequire(specifier);
  } catch (err) {
    throw new Error(`Cannot load optional dependency "${specifier}" in this runtime: ${(err as Error).message}`);
  }
}


