import { describe, expect, it } from "vitest";

import { getAdapter } from "@/lib/db/driver";
import { decryptConnectionSecrets } from "@/lib/db/helpers/credentialCipher";
import { KiroExecutor } from "@/server/llm-gateway/engine/executors/kiro";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";
import { translateRequest } from "@/server/llm-gateway/engine/translator";
import { refreshKiroToken } from "@/server/llm-gateway/engine/services/tokenRefresh";

/**
 * Diagnostic live probe for the Kiro provider. Off by default: it reads the
 * account's real kiro connections (decrypted in memory only) and sends one
 * tiny generateAssistantResponse per upstream surface. Prints status codes and
 * sanitized error snippets only; no token is ever logged.
 *
 *   LIVE_KIRO=1 npx vitest run tests/unit/kiroLive.test.ts
 */
const live = process.env.LIVE_KIRO === "1";
const MODEL = process.env.LIVE_KIRO_MODEL || "claude-sonnet-4.5";
const SECRET_LIKE = /[A-Za-z0-9+/_=-]{40,}/g;

function sanitize(text: string): string {
  return text.replace(SECRET_LIKE, "<redacted>").slice(0, 220);
}

async function probe(url: string, headers: Record<string, string>, payload: unknown) {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  const bytes = await res.arrayBuffer();
  const text = new TextDecoder().decode(bytes.slice(0, 1200));
  return {
    url: url.replace(/^https:\/\//, ""),
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    bytes: bytes.byteLength,
    snippet: sanitize(text.replace(/[^ -~]+/g, " ")),
  };
}

describe.skipIf(!live)("Kiro live diagnostic", () => {
  it("probes every upstream surface with the executor's own headers and body", async () => {
    const db = await getAdapter();
    const rows = (await db.all(
      "SELECT id, userId, authType, isActive, data FROM providerConnections WHERE provider = ?",
      ["kiro"],
    )) as Array<{ id: string; userId: string; authType: string; isActive: number | boolean; data: string }>;

    const summary = rows.map((row) => {
      const data = decryptConnectionSecrets(JSON.parse(row.data || "{}"));
      const psd = (data.providerSpecificData || {}) as Record<string, unknown>;
      return {
        id: row.id,
        isActive: row.isActive === 1 || row.isActive === true,
        authType: row.authType,
        authMethod: psd.authMethod ?? null,
        hasAccessToken: typeof data.accessToken === "string" && data.accessToken.length > 0,
        hasRefreshToken: typeof data.refreshToken === "string" && data.refreshToken.length > 0,
        hasApiKey: typeof data.apiKey === "string" && data.apiKey.length > 0,
        hasProfileArn: typeof psd.profileArn === "string" && psd.profileArn.length > 0,
        region: psd.region ?? null,
        expiresAt: data.expiresAt ?? null,
        testStatus: data.testStatus ?? null,
        lastErrorSnippet: data.lastError ? sanitize(String(data.lastError)) : null,
        data,
      };
    });
    console.log("KIRO_CONNECTIONS", JSON.stringify(summary.map(({ data, ...rest }) => rest), null, 2));
    expect(rows.length).toBeGreaterThanOrEqual(0);

    const results: unknown[] = [];
    for (const entry of summary.filter((s) => s.isActive)) {
      let credentials = { ...entry.data, connectionId: entry.id } as Record<string, unknown>;
      const expired = typeof credentials.expiresAt === "string" && Date.parse(credentials.expiresAt) < Date.now();
      if (expired && credentials.refreshToken) {
        const refreshed = await refreshKiroToken(
          String(credentials.refreshToken),
          credentials.providerSpecificData as never,
        );
        if (refreshed?.accessToken) credentials = { ...credentials, accessToken: refreshed.accessToken };
      }
      const executor = new KiroExecutor();
      const body = translateRequest(
        FORMATS.OPENAI,
        FORMATS.KIRO,
        MODEL,
        { messages: [{ role: "user", content: "Responda apenas: pong" }], stream: true },
        true,
        credentials as never,
        "kiro",
        null,
        [],
        entry.id,
      ) as Record<string, unknown>;
      const urls = [...new Set([...executor.getOrderedBaseUrls(credentials as never), ...executor.getBaseUrls()])];
      const probes = [];
      for (const url of urls) {
        const headers = executor.buildHeaders(credentials as never, true, url);
        probes.push(await probe(url, headers, body));
      }
      results.push({ connection: entry.id, authMethod: entry.authMethod, expired, probes });
    }
    console.log("KIRO_PROBES", JSON.stringify(results, null, 2));
  }, 120_000);
});
