import { Service } from "cordis";
import type { Context } from "cordis";
import providerRegistry from "@/server/llm-gateway/engine/providers/registry";
import { registerProvider } from "../pluginRegistry";

export interface ProviderConfig {
  id: string;
  [key: string]: unknown;
}

declare module "cordis" {
  interface Context {
    providers: ProvidersService;
  }
}

export class ProvidersService extends Service {
  private map: Map<string, ProviderConfig>;

  constructor(ctx: Context) {
    super(ctx, "providers");
    this.map = new Map(
      (providerRegistry as ProviderConfig[]).map((p) => [p.id, p])
    );
  }

  getById(id: string): ProviderConfig | null {
    return this.map.get(id) ?? null;
  }

  getAll(): ProviderConfig[] {
    return [...this.map.values()];
  }

  /** Contribute or override a provider config. Visible to `getById`/`getAll` on this context and to the shared plugin registry. */
  register(config: ProviderConfig): void {
    this.map.set(config.id, config);
    registerProvider(config);
  }
}
