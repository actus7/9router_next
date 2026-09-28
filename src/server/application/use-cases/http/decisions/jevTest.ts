import { NextResponse } from "next/server";
import { probeJev } from "@/server/decisions/jev";

// "Testar Jev" in the profile's decision-engine card: one tiny billed call
// that reports why Jev is unusable, instead of the silent heuristic fallback.
export async function POST(): Promise<NextResponse> {
  const result = await probeJev();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
