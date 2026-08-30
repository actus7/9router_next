import type { Context } from "cordis";
import { ProvidersService } from "../services/providers-service";

export const providersPlugin = {
  name: "squid-providers",
  apply(ctx: Context): void {
    new ProvidersService(ctx);
  },
};
