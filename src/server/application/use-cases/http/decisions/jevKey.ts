import { NextResponse } from "next/server";
import { probeJev } from "@/server/decisions/jev";
import { hasTypesafeKey, removeTypesafeKey, saveTypesafeKey } from "@/lib/db/repos/decisionKeysRepo";

// The profile card's "TypeSafe key" form. A key is tried against TypeSafe
// before it is kept, so a typo shows up here instead of as every decision
// silently falling back to the heuristic. The key itself never comes back.
const NO_STORE = { "Cache-Control": "no-store" };
const PROBE_TIMEOUT_MS = 15_000;
const MAX_KEY_CHARS = 512;

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ typesafe: await hasTypesafeKey() }, { headers: NO_STORE });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as { apiKey?: unknown } | null;
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey || apiKey.length > MAX_KEY_CHARS) {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400, headers: NO_STORE });
  }
  const probe = await probeJev(PROBE_TIMEOUT_MS, { typesafeKey: apiKey });
  if (!probe.ok) return NextResponse.json(probe, { status: 400, headers: NO_STORE });
  await saveTypesafeKey(apiKey);
  return NextResponse.json(probe, { headers: NO_STORE });
}

export async function DELETE(): Promise<NextResponse> {
  await removeTypesafeKey();
  return NextResponse.json({ typesafe: false }, { headers: NO_STORE });
}
