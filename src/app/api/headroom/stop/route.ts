import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextResponse } from "next/server";
import { stopHeadroomProxy } from "@/lib/headroom/process";


async function handlePOST() {
  try {
    const result = stopHeadroomProxy();
    const status = result.stopped ? 200 : 409;
    return NextResponse.json({ ...result }, { status });
  } catch (error: unknown) {
    const err = error as Error & { code?: string };
    return NextResponse.json({ error: err.message, code: err.code || null }, { status: 500 });
  }
}

export const POST = tenantRoute(handlePOST);
