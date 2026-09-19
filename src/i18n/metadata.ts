import type { Metadata } from "next";
import { getI18nProps } from "./server";

/**
 * Localized `<title>` / `<meta name="description">` for a route.
 *
 * The runtime translator rewrites text nodes under `document.body`, which the
 * document head is not — so a browser tab stayed in English no matter what the
 * dictionary said. Metadata is resolved on the server instead, from the same
 * literal files, keyed by the English string exactly like every other literal.
 */
export async function localizedMetadata(
  title: string,
  description: string,
  extra: Metadata = {},
): Promise<Metadata> {
  const { translations } = await getI18nProps();
  return {
    ...extra,
    title: translations[title] ?? title,
    description: translations[description] ?? description,
  };
}
