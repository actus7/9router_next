/**
 * TLS-impersonating fetch for opencode.ai's free tier.
 *
 * The free gate keys on the TLS ClientHello: the same body and headers answer
 * 429 FreeUsageLimitError over Node's OpenSSL handshake and 200 over a
 * BoringSSL one. Only the cipher-list hash (JA4) is compared, so the list below
 * must stay verbatim — reordering passes, dropping an entry fails.
 * Measured here 2026-10-31 (node fetch 429, wreq-js 200, same process and IP);
 * upstream finding in decolua/9router ce060c79.
 *
 * `wreq-js` is a native module loaded on first use. Without it the request
 * fails with a message that names the fix, instead of a bare 429 that reads
 * as "out of quota".
 */

const OPENCODE_CIPHER_LIST = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-ECDSA-AES128-SHA",
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-ECDSA-AES256-SHA",
  "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
  "AES128-SHA",
  "AES256-SHA",
].join(":");

// wreq's `timeout` bounds the whole request, body included (default 30s), so
// any finite value cuts a long SSE stream mid-answer. 0 disables it, matching
// the Node fetch path: the caller's abort signal and the combo's first-byte
// budget bound the wait, and the invocation's maxDuration bounds the rest.
const NO_TOTAL_TIMEOUT = 0;

interface WreqResponse {
  status: number;
  statusText?: string;
  headers?: { forEach?: (cb: (value: string, key: string) => void) => void };
  body: ReadableStream<Uint8Array> | null;
}
interface WreqClient {
  transport: unknown;
  fetch(url: string, init: Record<string, unknown>): Promise<WreqResponse>;
}

// Statuses whose Response must have a null body (the constructor throws otherwise).
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

export class OpencodeTlsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpencodeTlsUnavailableError";
  }
}

// A transport, not a session: it pools connections and caches TLS sessions but
// keeps no cookie jar, so one account's Set-Cookie never rides on another's call.
let clientPromise: Promise<WreqClient> | null = null;

function loadClient(): Promise<WreqClient> {
  clientPromise ??= (async () => {
    // Indirected so the bundler leaves the native module to the runtime
    // (it is also in next.config serverExternalPackages).
    const pkg = "wreq-js";
    const wreq = (await import(/* webpackIgnore: true */ pkg)) as {
      createTransport?: (opts: unknown) => Promise<unknown>;
      fetch?: WreqClient["fetch"];
    };
    if (typeof wreq.createTransport !== "function" || typeof wreq.fetch !== "function") {
      throw new Error("wreq-js has no createTransport/fetch");
    }
    const transport = await wreq.createTransport({ emulation: { tlsOptions: { cipherList: OPENCODE_CIPHER_LIST } } });
    return { transport, fetch: wreq.fetch };
  })().catch((error: unknown) => {
    clientPromise = null;
    throw error;
  });
  return clientPromise;
}

/**
 * Fetch through the impersonated-TLS transport. Returns a native Response whose
 * body is the live stream, so SSE consumers keep working unchanged.
 */
export async function opencodeTlsFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let client: WreqClient;
  try {
    client = await loadClient();
  } catch (error) {
    throw new OpencodeTlsUnavailableError(
      `wreq-js unavailable (${error instanceof Error ? error.message : "unknown"}): the OpenCode free tier refuses Node's TLS handshake without it`,
    );
  }
  const options: Record<string, unknown> = {
    method: init.method || "GET",
    headers: init.headers,
    redirect: "follow",
    timeout: NO_TOTAL_TIMEOUT,
    transport: client.transport,
  };
  if (init.body !== undefined && init.body !== null) options.body = init.body;
  if (init.signal) options.signal = init.signal;

  const res = await client.fetch(url, options);
  const headers = new Headers();
  res.headers?.forEach?.((value, key) => headers.set(key, value));
  const body = NULL_BODY_STATUSES.has(res.status) ? null : res.body;
  if (body === null) void res.body?.cancel().catch(() => undefined);
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

export const __test__ = { OPENCODE_CIPHER_LIST };
