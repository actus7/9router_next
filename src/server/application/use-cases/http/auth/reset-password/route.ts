import { NextResponse } from "next/server";
import { updateSettings } from "@/lib/db/repos/settingsRepo";
// Reset dashboard password to default by clearing the stored hash.
// Local-only (enforced by dashboardGuard). Never returns the default literal.
export async function POST(): Promise<NextResponse> {
  try {
    await updateSettings({ password: null });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
