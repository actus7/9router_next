import { UPDATER_CONFIG } from "@/shared/constants/config";

/**
 * Base URL the server uses to call its own public gateway API (chat/embeddings/
 * images/audio) for connection and model testing. On Vercel there is no
 * loopback listener reachable between/within function invocations, so
 * VERCEL_URL (the deployment's own public host, injected automatically) is
 * used instead of 127.0.0.1.
 */
export function getInternalBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;
}
