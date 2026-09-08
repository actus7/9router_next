import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextRequest, NextResponse  } from "next/server";
import { getInstallLogTail } from "@/lib/pxpipe/install";
import { readPxpipeEvents } from "@/lib/pxpipe/events";


async function handleGET(request: NextRequest) {
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

export const GET = tenantRoute(handleGET);
