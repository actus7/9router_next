import "server-only";

import { assertPublicUrl } from "@/shared/utils/ssrfGuard";

/**
 * Whether this deployment lets an account point a provider at a private address.
 *
 * On a self-hosted, single-account install that is the whole point: Ollama on
 * `127.0.0.1:11434`, an inference box on the LAN. On a deployment where anyone
 * can sign up it is a server-side request forgery primitive — the account
 * supplies the URL, the gateway fetches it with the server's own network
 * position, and the upstream body comes back through `parseUpstreamError`. That
 * reaches the cloud metadata service on `169.254.169.254` and every internal
 * host besides.
 *
 * Off by default, so a hosted deployment is safe without knowing to configure
 * anything. Self-hosted installs set `ALLOW_PRIVATE_PROVIDER_ENDPOINTS=true`.
 */
export function privateProviderEndpointsAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_PROVIDER_ENDPOINTS === "true";
}

class ProviderEndpointBlockedError extends Error {
  constructor(url: string) {
    super(
      `Provider endpoint "${url}" points at a private or loopback address. ` +
      `Set ALLOW_PRIVATE_PROVIDER_ENDPOINTS=true on a self-hosted install to permit it.`,
    );
    this.name = "ProviderEndpointBlockedError";
  }
}

/**
 * Throws unless `rawUrl` is an acceptable provider endpoint for this deployment.
 *
 * Checks the literal host. A hostname that *resolves* to a private address still
 * gets through — closing that needs the DNS-pinned path in
 * `server/security/safeFetch.ts`, which the inference executors do not use
 * because they stream. The literal case is the one that is trivially
 * exploitable, and it is the one this closes.
 */
export function assertProviderEndpointAllowed(rawUrl: string): void {
  if (privateProviderEndpointsAllowed()) return;
  try {
    assertPublicUrl(rawUrl);
  } catch {
    throw new ProviderEndpointBlockedError(rawUrl);
  }
}
