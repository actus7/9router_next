import { NextRequest, NextResponse  } from "next/server";
import { findPython310, getInstalledHeadroomExtras, HEADROOM_COMPRESSION_EXTRAS } from "@/lib/headroom/detect";
import { installHeadroomExtras, uninstallHeadroomExtras, getInstallLogTail } from "@/lib/headroom/process";


export async function GET(req: NextRequest) {
  try {
    // `?log=1` returns the live install/uninstall log tail for progress polling.
    if (new URL(req.url).searchParams.get("log") === "1") {
      return NextResponse.json({ log: getInstallLogTail() });
    }
    const python = findPython310();
    const status = getInstalledHeadroomExtras(python);
    return NextResponse.json({
      available: HEADROOM_COMPRESSION_EXTRAS,
      ...status,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const requested = Array.isArray(body?.extras) ? body.extras : [];
    const result = await installHeadroomExtras(requested);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const errObj = error as Record<string, unknown>;
    const status = errObj.code === "NOT_INSTALLED" || errObj.code === "NO_PYTHON" ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: errObj.code || null }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const requested = Array.isArray(body?.extras) ? body.extras : [];
    const result = await uninstallHeadroomExtras(requested);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const errObj = error as Record<string, unknown>;
    const status = errObj.code === "NO_PYTHON" || errObj.code === "INVALID_EXTRAS" ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: errObj.code || null }, { status });
  }
}
