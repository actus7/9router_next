import { BaseExecutor } from "./base";
import type { ExecuteArgs } from "./base";

/**
 * Puter (MiMo) only runs client-side via the Puter browser SDK — the chat UI
 * intercepts this provider before any request reaches the server (see
 * puterBrowser.ts). If a request reaches here anyway (e.g. direct API call
 * with a ModelHub key), reject with a clear message instead of trying to
 * fetch a nonexistent server-side endpoint.
 */
export class PuterExecutor extends BaseExecutor {
  constructor() {
    super("puter", { noAuth: true });
  }

  async execute(_args: ExecuteArgs): Promise<never> {
    throw new Error(
      "Puter (MiMo) runs via the browser Puter session — use the ModelHub chat UI for this provider, not the API directly."
    );
  }
}

export default PuterExecutor;
