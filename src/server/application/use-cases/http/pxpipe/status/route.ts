import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { getPxpipeStatus } from "@/lib/pxpipe/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSettings();
    const status = getPxpipeStatus();
    return NextResponse.json({
      ...status,
      enabled: !!settings.pxpipeEnabled,
      autoInstall: !!settings.pxpipeAutoInstall,
      minChars: settings.pxpipeMinChars,
      timeoutMs: settings.pxpipeTimeoutMs,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
