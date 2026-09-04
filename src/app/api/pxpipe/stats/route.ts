import { NextRequest, NextResponse  } from "next/server";
import { getPxpipeStats } from "@/lib/pxpipe/events";


export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const recentLimit = Math.min(Number(searchParams.get("limit")) || 100, 500);
    return NextResponse.json(getPxpipeStats({ recentLimit }));
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
