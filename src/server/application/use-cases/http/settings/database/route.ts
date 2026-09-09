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

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { password: _ignored, ...payload } = await request.json();
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
