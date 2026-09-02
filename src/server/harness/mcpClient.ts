import "server-only";
import { lookup } from "node:dns/promises";
import { Agent, type Dispatcher } from "undici";
import { assertPublicUrl, isBlockedIpAddress } from "@/shared/utils/ssrfGuard";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_TIMEOUT_MS = 12_000;
const MAX_TOOLS = 64;

export interface DiscoveredMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpRpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: unknown };
}

function assertSafeMcpUrl(url: string) {
  assertPublicUrl(url);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("MCP remoto deve usar HTTPS");
  }
}

/**
 * Resolves the hostname once, validates every returned address, and returns
 * an undici Agent whose `connect.lookup` is pinned to the validated IP.
 * Every fetch in the same logical operation must reuse this one dispatcher
 * so DNS cannot be rebound between the guard check and the request(s) that
 * follow it (TOCTOU) — the connection-level hostname resolution never runs
 * again after this point for that operation.
 */
async function resolvePinnedDispatcher(url: string): Promise<Dispatcher> {
  const hostname = new URL(url).hostname;
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => isBlockedIpAddress(address))
  ) {
    throw new Error("Blocked URL: internal host");
  }
  const pinned = addresses[0]!;
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
        else callback(null, pinned.address, pinned.family);
      },
    },
  });
}

function parseRpc(text: string, expectedId: number): McpRpcResponse | null {
  const candidates = text.includes("data:")
    ? text
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s*/, ""))
    : [text];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as McpRpcResponse;
      if (parsed.id === expectedId) return parsed;
    } catch {
      /* ignore malformed SSE frames */
    }
  }
  return null;
}

async function rpc(
  url: string,
  body: Record<string, unknown>,
  dispatcher: Dispatcher,
  sessionId?: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
      // @ts-expect-error -- `dispatcher` is an undici-specific fetch extension pinning the connection to the DNS-validated IP; not in the standard lib.dom fetch types.
      dispatcher,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error(
          "Este servidor MCP requer autenticação, que ainda não foi configurada.",
        );
      throw new Error(`MCP respondeu com status ${response.status}`);
    }
    return {
      payload: parseRpc(
        await response.text(),
        typeof body.id === "number" ? body.id : -1,
      ),
      sessionId: response.headers.get("mcp-session-id") ?? sessionId,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function openSession(url: string): Promise<{ sessionId: string | undefined; dispatcher: Dispatcher }> {
  assertSafeMcpUrl(url);
  const dispatcher = await resolvePinnedDispatcher(url);
  const initialized = await rpc(url, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "modelhub-harness", version: "1" },
    },
  }, dispatcher);
  if (!initialized.payload?.result)
    throw new Error(
      initialized.payload?.error?.message
        ? String(initialized.payload.error.message)
        : "Resposta MCP inválida no initialize",
    );
  await rpc(
    url,
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    dispatcher,
    initialized.sessionId,
  ).catch(() => undefined);
  return { sessionId: initialized.sessionId, dispatcher };
}

function normalizeTools(value: unknown): DiscoveredMcpTool[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TOOLS).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const tool = item as Record<string, unknown>;
    if (
      typeof tool.name !== "string" ||
      !/^[a-zA-Z0-9_.-]{1,128}$/.test(tool.name)
    )
      return [];
    return [
      {
        name: tool.name,
        description:
          typeof tool.description === "string"
            ? tool.description.slice(0, 2_000)
            : "MCP tool",
        inputSchema:
          tool.inputSchema &&
          typeof tool.inputSchema === "object" &&
          !Array.isArray(tool.inputSchema)
            ? (tool.inputSchema as Record<string, unknown>)
            : { type: "object", properties: {} },
      },
    ];
  });
}

export async function discoverMcpTools(
  url: string,
): Promise<DiscoveredMcpTool[]> {
  const { sessionId, dispatcher } = await openSession(url);
  const listed = await rpc(
    url,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    dispatcher,
    sessionId,
  );
  if (!listed.payload?.result)
    throw new Error(
      listed.payload?.error?.message
        ? String(listed.payload.error.message)
        : "Resposta MCP inválida no tools/list",
    );
  return normalizeTools(listed.payload.result.tools);
}

export async function callMcpTool(
  url: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { sessionId, dispatcher } = await openSession(url);
  const result = await rpc(
    url,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    },
    dispatcher,
    sessionId,
  );
  if (!result.payload?.result)
    throw new Error(
      result.payload?.error?.message
        ? String(result.payload.error.message)
        : "Resposta MCP inválida no tools/call",
    );
  return result.payload.result;
}
