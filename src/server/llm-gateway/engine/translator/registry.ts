// Translator registry — extracted from index.ts to break circular dependencies.
// Translator modules import register() from here; index.ts re-exports for backward compat.

export type RequestTranslatorFn = (model: string, body: Record<string, unknown>, stream: boolean, credentials?: unknown) => Record<string, unknown>;
export type ResponseTranslatorFn = (chunk: unknown, state: unknown) => unknown;

export let requestRegistry: Map<string, RequestTranslatorFn> | undefined;
export let responseRegistry: Map<string, ResponseTranslatorFn> | undefined;

export function register(from: string, to: string, requestFn: RequestTranslatorFn | null | undefined, responseFn: ResponseTranslatorFn | null | undefined) {
  requestRegistry ??= new Map();
  responseRegistry ??= new Map();
  const key = `${from}:${to}`;
  if (requestFn) {
    requestRegistry.set(key, requestFn);
  }
  if (responseFn) {
    responseRegistry.set(key, responseFn);
  }
}
