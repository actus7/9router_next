import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { assertPublicUrl, isBlockedIpAddress } from "@/shared/utils/ssrfGuard";

export type DestinationPolicy = "public-only" | "trusted-local";

type ResolvedAddress = { address: string; family: number };
type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;
type FetchWithDispatcher = (
  input: string | URL,
  init: RequestInit & { dispatcher?: Dispatcher },
) => Promise<Response>;

export interface SafeFetchOptions extends RequestInit {
  destinationPolicy?: DestinationPolicy;
  maxRedirects?: number;
  timeoutMs?: number;
}

interface SafeFetchDependencies {
  fetchImpl?: FetchWithDispatcher;
  resolver?: Resolver;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_HEADERS = ["authorization", "cookie", "proxy-authorization"];

const systemResolver: Resolver = async (hostname) => {
  if (isIP(hostname)) {
    return [{ address: hostname, family: isIP(hostname) }];
  }
  return lookup(hostname, { all: true, verbatim: true });
};

function validateDestination(url: URL, policy: DestinationPolicy): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Blocked URL: unsupported protocol");
  }
  if (url.username || url.password) {
    throw new Error("Blocked URL: embedded credentials");
  }
  if (policy === "public-only") assertPublicUrl(url.href);
}

async function resolveDestination(
  url: URL,
  policy: DestinationPolicy,
  resolver: Resolver,
): Promise<ResolvedAddress> {
  const addresses = await resolver(url.hostname);
  if (addresses.length === 0) throw new Error("DNS resolution returned no addresses");

  if (policy === "public-only") {
    const blocked = addresses.find(({ address }) => isBlockedIpAddress(address));
    if (blocked) throw new Error(`Blocked URL: DNS resolved to private IP ${blocked.address}`);
  }

  return addresses[0];
}

function createPinnedAgent(hostname: string, resolved: ResolvedAddress): Agent {
  return new Agent({
    connect: {
      // `node:net` calls this with `all: true` and then reads `addresses[0].address`,
      // so the single-address callback form resolves to `undefined` and the socket
      // fails with `ERR_INVALID_IP_ADDRESS`, surfacing as a bare "fetch failed".
      // Honour both contracts so the pin works regardless of the caller.
      lookup: (requestedHostname, options, callback) => {
        const mismatch =
          requestedHostname.toLowerCase() !== hostname.toLowerCase()
            ? new Error("Pinned DNS hostname mismatch")
            : null;
        if (options?.all) {
          const addresses = mismatch ? [] : [{ address: resolved.address, family: resolved.family }];
          (callback as (err: Error | null, addresses: ResolvedAddress[]) => void)(
            mismatch,
            addresses,
          );
          return;
        }
        callback(mismatch, resolved.address, resolved.family);
      },
    },
  });
}

async function closeAgent(agent: Agent): Promise<void> {
  await agent.close().catch(() => undefined);
}

function responseWithAgentLifecycle(response: Response, agent: Agent): Response {
  if (!response.body) {
    void closeAgent(agent);
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          await closeAgent(agent);
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
        await closeAgent(agent);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await closeAgent(agent);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function redirectedRequest(
  currentUrl: URL,
  nextUrl: URL,
  status: number,
  init: RequestInit,
): RequestInit {
  const headers = new Headers(init.headers);
  if (currentUrl.origin !== nextUrl.origin) {
    for (const header of SENSITIVE_HEADERS) headers.delete(header);
  }

  const method = (init.method ?? "GET").toUpperCase();
  const becomesGet = status === 303 || ((status === 301 || status === 302) && method === "POST");
  if (!becomesGet) return { ...init, headers };

  headers.delete("content-length");
  headers.delete("content-type");
  return { ...init, method: "GET", body: undefined, headers };
}

export function createSafePublicFetch(dependencies: SafeFetchDependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? (undiciFetch as unknown as FetchWithDispatcher);
  const resolver = dependencies.resolver ?? systemResolver;

  return async function safePublicFetch(
    input: string | URL,
    options: SafeFetchOptions = {},
  ): Promise<Response> {
    const {
      destinationPolicy = "public-only",
      maxRedirects = 3,
      timeoutMs = 15_000,
      ...requestOptions
    } = options;
    let currentUrl = new URL(input);
    let currentInit: RequestInit = { ...requestOptions, redirect: "manual" };

    for (let redirectCount = 0; ; redirectCount += 1) {
      validateDestination(currentUrl, destinationPolicy);
      const resolved = await resolveDestination(currentUrl, destinationPolicy, resolver);
      const agent = createPinnedAgent(currentUrl.hostname, resolved);
      const signals = [AbortSignal.timeout(timeoutMs)];
      if (currentInit.signal) signals.push(currentInit.signal);

      let response: Response;
      try {
        response = await fetchImpl(currentUrl, {
          ...currentInit,
          redirect: "manual",
          signal: AbortSignal.any(signals),
          dispatcher: agent,
        });
      } catch (error) {
        await closeAgent(agent);
        throw error;
      }

      const location = response.headers.get("location");
      if (!REDIRECT_STATUSES.has(response.status) || !location) {
        return responseWithAgentLifecycle(response, agent);
      }

      await response.body?.cancel();
      await closeAgent(agent);
      if (redirectCount >= maxRedirects) throw new Error(`Too many redirects (maximum ${maxRedirects})`);

      const nextUrl = new URL(location, currentUrl);
      currentInit = redirectedRequest(currentUrl, nextUrl, response.status, currentInit);
      currentUrl = nextUrl;
    }
  };
}

export const safePublicFetch = createSafePublicFetch();
