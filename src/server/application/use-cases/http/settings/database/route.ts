import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { exportDb, importDb } from "@/lib/db/index";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";

/**
 * Export and import used to demand the operator password on top of the session,
 * because they moved the whole database. They no longer can: both are scoped to
 * the calling account now, so an export contains only the caller's rows and an
 * import replaces only the caller's rows. The session that got the request here
 * is the same authority the rest of the dashboard runs on.
 */

export async function GET(): Promise<NextResponse> {
  try {
    const payload = await exportDb();
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

/**
 * Ceilings on an import payload.
 *
 * `importDb` runs every collection inside one transaction, so an oversized
 * payload is not just a big allocation — it is a big allocation plus a Neon
 * transaction held open for the length of it. The route had no limit of any
 * kind: no body cap, no `Array.isArray`, no element count. With
 * `proxyClientMaxBodySize` at 128mb, one signed-in account could OOM the
 * instance for everybody. These numbers are orders of magnitude above a real
 * export.
 */
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_ROWS_PER_COLLECTION = 5_000;
const IMPORT_ARRAY_COLLECTIONS = [
  "providerConnections",
  "providerNodes",
  "proxyPools",
  "apiKeys",
  "combos",
  "smartModelProfiles",
  "modelAvailability",
  "customModels",
] as const;
const IMPORT_OBJECT_COLLECTIONS = ["settings", "modelAliases", "pricing"] as const;

/** Null when the payload is acceptable, otherwise the reason to send back. */
function rejectImportPayload(payload: Record<string, unknown>): string | null {
  for (const key of IMPORT_ARRAY_COLLECTIONS) {
    const value = payload[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) return `"${key}" must be an array`;
    if (value.length > MAX_ROWS_PER_COLLECTION) {
      return `"${key}" has ${value.length} rows, more than the ${MAX_ROWS_PER_COLLECTION} an import accepts`;
    }
  }
  for (const key of IMPORT_OBJECT_COLLECTIONS) {
    const value = payload[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "object" || Array.isArray(value)) return `"${key}" must be an object`;
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Read as text first: `request.json()` on a 128mb body materialises the
    // parsed object before anything gets to look at its size.
    const raw = await request.text();
    if (raw.length > MAX_IMPORT_BYTES) {
      return NextResponse.json(
        { error: `Import payload is larger than the ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB limit.` },
        { status: 413 },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Import payload is not valid JSON." }, { status: 400 });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Import payload must be a JSON object." }, { status: 400 });
    }

    const { password: _ignored, ...payload } = parsed as Record<string, unknown>;
    const rejection = rejectImportPayload(payload);
    if (rejection) {
      return NextResponse.json({ error: `Import rejected: ${rejection}.` }, { status: 400 });
    }

    await importDb(payload);

    // Ensure proxy settings take effect immediately after a DB import.
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error importing database:", error);
    // The message is a Postgres error more often than a validation one, and it
    // carries query text and constraint names. The log above keeps the detail.
    return NextResponse.json(
      { error: "Failed to import database — the payload was rejected." },
      { status: 400 }
    );
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
