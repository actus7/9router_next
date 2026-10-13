import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { isLocalRequest } from "@/dashboardGuard";
import { assertPublicUrl, isBlockedIpAddress } from "@/shared/utils/ssrfGuard";

/**
 * Whether the proxy lives on a private address. A self-hosted install's proxy
 * usually does (127.0.0.1:7890), and testing it from this machine is the point;
 * testing one from across the network would make the server a port scanner of
 * its own network for anyone who signed up.
 * ponytail: resolved once here and again by the proxy agent; pin the address if
 * DNS rebinding against this admin-only endpoint ever matters.
 */
async function isPrivateProxy(proxyUrl: unknown): Promise<boolean> {
  let host: string;
  try {
    host = new URL(String(proxyUrl ?? "")).hostname.replace(/^\[|\]$/g, "");
    assertPublicUrl(`http://${host.includes(":") ? `[${host}]` : host}/`);
  } catch {
    return true;
  }
  const addresses = await lookup(host, { all: true }).catch(() => []);
  return addresses.some((entry) => isBlockedIpAddress(entry.address));
}

async function handlePOST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    if (!isLocalRequest(request) && (await isPrivateProxy(body?.proxyUrl))) {
      return NextResponse.json(
        { ok: false, error: "A proxy on a private address can only be tested from the machine running ModelHub." },
        { status: 400 },
      );
    }
    const result = await testProxyUrl({
      proxyUrl: body?.proxyUrl,
      testUrl: body?.testUrl,
      timeoutMs: body?.timeoutMs,
    });

    if (result?.ok) {
      return NextResponse.json(result);
    }

    const status = typeof result?.status === "number" ? result.status : 500;
    return NextResponse.json({ ok: false, error: result?.error || "Proxy test failed" }, { status });
  } catch (err) {
    const message = (err as Error)?.name === "AbortError" ? "Proxy test timed out" : ((err as Error)?.message || String(err));
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const POST = tenantRoute(handlePOST);
