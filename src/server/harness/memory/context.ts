import "server-only";

import { buildMemorySnapshot } from "./applyMemoryWrite";

let cachedSnapshot: Awaited<ReturnType<typeof buildMemorySnapshot>> | null = null;
let cachedRevision = -1;

export async function reloadMemorySnapshot() {
  const snapshot = await buildMemorySnapshot();
  if (cachedRevision !== snapshot.revision) {
    cachedRevision = snapshot.revision;
    cachedSnapshot = snapshot;
  }
  return snapshot;
}

export async function invalidateMemoryCache() {
  cachedRevision = -1;
  cachedSnapshot = null;
  return reloadMemorySnapshot();
}

export function getCachedMemorySnapshot() {
  return cachedSnapshot;
}
