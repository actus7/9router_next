import { NextResponse } from "next/server";
import { stopHeadroomProxy } from "@/lib/headroom/process";


export async function POST() {
  try {
    const result = stopHeadroomProxy();
    const status = result.stopped ? 200 : 409;
    return NextResponse.json({ ...result }, { status });
  } catch (error: unknown) {
    const err = error as Error & { code?: string };
    return NextResponse.json({ error: err.message, code: err.code || null }, { status: 500 });
  }
}
