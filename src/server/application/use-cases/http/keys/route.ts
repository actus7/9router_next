import { NextRequest, NextResponse } from "next/server";
import { createApiKey, getApiKeys, issueApiKeyForSink, type ApiKeySink } from "@/lib/db/repos/apiKeysRepo";
import { getConsistentMachineId } from "@/shared/utils/machineId";

/**
 * A caller may say which destination the key is for, so the inventory can later
 * answer where it went. Anything unrecognised becomes "manual" rather than
 * being trusted verbatim — `sink` drives revocation, so a caller must not be
 * able to invent a destination that no teardown path knows how to clean up.
 */
function parseSink(raw: unknown): ApiKeySink {
  if (typeof raw !== "string") return "manual";
  if (raw === "dashboard" || raw === "manual") return raw;
  const match = /^(cli|cloud):([a-z0-9._-]{1,64})$/i.exec(raw);
  return match ? (`${match[1].toLowerCase()}:${match[2]}` as ApiKeySink) : "manual";
}


// GET /api/keys - List API keys
export async function GET(): Promise<NextResponse> {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.error("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const sink = parseSink(body?.sink);
    const sinkRef = typeof body?.sinkRef === "string" ? body.sinkRef : null;

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    // A named destination reuses its live key instead of minting another on
    // every call, so reconfiguring a target does not fill the inventory with
    // keys nobody can account for. "manual" means the operator asked for a key
    // themselves, and asking twice should give two keys — so it always mints.
    const apiKey = sink === "manual"
      ? await createApiKey(name, machineId, "manual", sinkRef)
      : await issueApiKeyForSink(name, machineId, sink, sinkRef);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      sink: apiKey.sink,
      sinkRef: apiKey.sinkRef,
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
