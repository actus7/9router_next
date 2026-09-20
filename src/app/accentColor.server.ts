import { cookies } from "next/headers";
import { ACCENT_COLOR_COOKIE, isValidAccentColor, type AccentColorId } from "@/shared/constants/accentColors";

// `isValidAccentColor` é type guard, então o retorno já é estreito — declará-lo
// assim deixa o valor utilizável como prop sem cast no chamador.
export async function readAccentColorAttribute(): Promise<AccentColorId | undefined> {
  const cookieStore = await cookies();
  const rawAccent = cookieStore.get(ACCENT_COLOR_COOKIE)?.value;
  return isValidAccentColor(rawAccent) && rawAccent !== "default" ? rawAccent : undefined;
}
