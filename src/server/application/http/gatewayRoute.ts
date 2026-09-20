import { NextResponse, connection } from "next/server";

import { resolveApiKeyOwner } from "@/lib/db/repos/apiKeysRepo";
import { withTenant } from "@/lib/db/tenant";
import { RATE_LIMIT_WINDOW_MS, consumeRateLimit, gatewayRateLimit } from "./rateLimit";

/**
 * Reads the API key from wherever a client protocol puts it.
 *
 * Four spellings because the gateway speaks four dialects: OpenAI sends a
 * bearer token, Anthropic `x-api-key`, Gemini `x-goog-api-key`, and Gemini's
 * REST clients a `?key=` query parameter.
 */
function extractApiKey(request: Request): string | null {
  const authHeader: string | null = request.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) return authHeader.slice(7).trim() || null;
  const apiKeyHeader: string | null = request.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader;
  const googleApiKeyHeader: string | null = request.headers.get("x-goog-api-key");
  if (googleApiKeyHeader) return googleApiKeyHeader;
  try {
    return new URL(request.url).searchParams.get("key");
  } catch {
    return null;
  }
}

type Handler<R extends Request, A extends unknown[]> = (request: R, ...rest: A) => Promise<Response> | Response;

/**
 * Wraps a gateway handler so the request runs as the account that owns the key
 * it authenticated with.
 *
 * This is the second and last place a tenant is established — the dashboard's
 * `tenantRoute` is the other. The key is what says whose provider accounts the
 * request may spend and whose usage it is recorded against, which is why an
 * unauthenticated gateway call is now a 401 rather than something the
 * `requireApiKey` setting could wave through: that setting lived in `settings`,
 * a table that cannot be read until the tenant is known.
 */
export function gatewayRoute<R extends Request, A extends unknown[]>(
  handler: Handler<R, A>,
): (request: R, ...rest: A) => Promise<Response> {
  return async (request: R, ...rest: A): Promise<Response> => {
    // See tenantRoute: under Cache Components a handler is prerendered unless
    // it declares that it reads the request.
    await connection();
    const key: string | null = extractApiKey(request);
    if (!key) {
      return NextResponse.json({ error: { message: "Missing API key", type: "invalid_request_error" } }, { status: 401 });
    }
    const owner = await resolveApiKeyOwner(key);
    if (!owner) {
      return NextResponse.json({ error: { message: "Invalid API key", type: "invalid_request_error" } }, { status: 401 });
    }
    // Keyed by account, not by key: several keys belong to one account and the
    // ceiling is meant to bound what that account can spend.
    const limited = consumeRateLimit(`gw:${owner.userId}`, gatewayRateLimit(), RATE_LIMIT_WINDOW_MS);
    if (!limited.allowed) {
      return NextResponse.json(
        { error: { message: "Rate limit exceeded", type: "rate_limit_error" } },
        { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
      );
    }
    return withTenant(owner.userId, async () => handler(request, ...rest));
  };
}
