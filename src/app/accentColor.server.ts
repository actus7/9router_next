import { cookies } from "next/headers";
import { ACCENT_COLOR_COOKIE, isValidAccentColor } from "@/shared/constants/accentColors";

export async function readAccentColorAttribute(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const rawAccent = cookieStore.get(ACCENT_COLOR_COOKIE)?.value;
  return isValidAccentColor(rawAccent) && rawAccent !== "default" ? rawAccent : undefined;
}
