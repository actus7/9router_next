import type { Context } from "cordis";
import { ExecutorsService } from "../services/executors-service";

export const executorsPlugin = {
  name: "squid-executors",
  apply(ctx: Context): void {
    new ExecutorsService(ctx);
  },
};
