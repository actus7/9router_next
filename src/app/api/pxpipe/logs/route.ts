import { NextRequest, NextResponse  } from "next/server";
import { getInstallLogTail } from "@/lib/pxpipe/install";
import { readPxpipeEvents } from "@/lib/pxpipe/events";


export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const limit = Math.min(Number(searchParams.get("limit")) || 100, 500);
    return NextResponse.json({
      installLog: getInstallLogTail(),
      events: readPxpipeEvents({ limit }).reverse(),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
