import { HEALTH_CHECK } from "./config";
import {
  probeUrlAlive as probeUrlAliveShared,
  waitForHealth as waitForHealthShared,
} from "../shared/healthCheck";
import type { CancelToken } from "../shared/types";

export async function probeUrlAlive(url: string): Promise<boolean> {
  return probeUrlAliveShared(url, HEALTH_CHECK);
}

export async function waitForHealth(
  url: string,
  cancelToken: CancelToken = { cancelled: false },
): Promise<boolean> {
  return waitForHealthShared(url, HEALTH_CHECK, cancelToken);
}
