import { HEALTH_CHECK } from "./config";
import { waitForHealth as waitForHealthShared } from "../shared/healthCheck";
import type { CancelToken } from "../shared/types";

export async function waitForHealth(
  url: string,
  cancelToken: CancelToken = { cancelled: false },
): Promise<boolean> {
  return waitForHealthShared(url, HEALTH_CHECK, cancelToken);
}
