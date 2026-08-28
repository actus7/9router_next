import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { ACCENT_COLOR_COOKIE, isValidAccentColor } from "@/shared/constants/accentColors";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { accentColor } = await request.json();

    if (!isValidAccentColor(accentColor)) {
      return NextResponse.json({ error: "Invalid accent color" }, { status: 400 });
    }

    const cookieStore = await cookies();
    if (accentColor === "default") {
      cookieStore.delete(ACCENT_COLOR_COOKIE);
    } else {
      cookieStore.set(ACCENT_COLOR_COOKIE, accentColor, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365, // 1 year
      });
    }

    return NextResponse.json({ success: true, accentColor });
  } catch {
    return NextResponse.json({ error: "Failed to set accent color" }, { status: 500 });
  }
}
