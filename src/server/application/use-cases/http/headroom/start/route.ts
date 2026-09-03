import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { startHeadroomProxy } from "@/lib/headroom/process";
import { DEFAULT_HEADROOM_URL, isLoopbackHeadroomUrl } from "@/lib/headroom/detect";


function parsePortFromUrl(url: string) {
  try {
    const u = new URL(url);
    const p = parseInt(u.port, 10);
    if (p > 0 && p < 65536) return p;
  } catch { /* ignore, fall through to default */ }
  return null;
}

export async function POST() {
  try {
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    if (!isLoopbackHeadroomUrl(url)) {
      return NextResponse.json({ error: "External Headroom proxies must be started outside ModelHub", code: "EXTERNAL_PROXY" }, { status: 400 });
    }
    const port = parsePortFromUrl(url) || 8787;
    const result = await startHeadroomProxy({
      port,
      codeAware: settings.headroomCodeAware === true,
      kompress: settings.headroomKompress !== false,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const err = error as Error & { code?: string };
    const status = err.code === "NOT_INSTALLED" ? 400 : 500;
    return NextResponse.json({ error: err.message, code: err.code || null }, { status });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
