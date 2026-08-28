import { VOICE_FETCHERS } from "@/lib/open-sse/handlers/ttsCore";
import { NextRequest, NextResponse  } from "next/server";

// Map locale code → country name
const LOCALE_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
const LANG_NAMES   = new Intl.DisplayNames(["en"], { type: "language" });

function countryName(code: string) {
  try { return LOCALE_NAMES.of(code); } catch { return code; }
}
function langName(code: string) {
  try { return LANG_NAMES.of(code); } catch { return code; }
}

/**
 * GET /api/media-providers/tts/voices
 * Query:
 *   ?provider=edge-tts | local-device | elevenlabs  (default: edge-tts)
 *   ?lang=en     (optional filter by lang code)
 *   ?apiKey=xxx  (required for elevenlabs)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provider   = searchParams.get("provider") || "edge-tts";
    const langFilter = searchParams.get("lang");
    const apiKey     = searchParams.get("apiKey");

    const fetcher = VOICE_FETCHERS[provider];
    if (!fetcher) {
      return NextResponse.json({ error: `Provider '${provider}' does not support voice listing` }, { status: 400 });
    }

    // ElevenLabs requires API key
    const raw = provider === "elevenlabs" ? await fetcher(apiKey) : await fetcher();
    const useElevenShape = provider === "elevenlabs" || provider === "gemini";
    let voices: Record<string, unknown>[];

    if (provider === "local-device") {
      voices = (raw as Record<string, unknown>[]).map((v) => ({
        id:      v.id,
        name:    v.name,
        locale:  (v.locale as string).replace("_", "-"),
        lang:    v.lang,
        country: v.country,
        countryName: countryName(v.country as string),
        langName:    langName(v.lang as string),
        gender:  v.gender,
      }));
    } else if (useElevenShape) {
      voices = (raw as Record<string, unknown>[]).map((v) => ({
        id:      v.voice_id,
        name:    v.name,
        locale:  (v.labels as Record<string, unknown>)?.language || "en",
        lang:    (((v.labels as Record<string, unknown>)?.language as string) || "en").split("-")[0],
        country: "",
        countryName: "",
        langName:    langName((((v.labels as Record<string, unknown>)?.language as string) || "en").split("-")[0]),
        gender:  (v.labels as Record<string, unknown>)?.gender || "",
        category: v.category,
      }));
    } else {
      // edge-tts (default)
      voices = (raw as Record<string, unknown>[]).map((v) => {
        const [lang, country] = (v.Locale as string).split("-");
        return {
          id:      v.ShortName,
          name:    ((v.FriendlyName || v.ShortName) as string)
            .replace("Microsoft ", "")
            .replace(/ Online \(Natural\) - /g, " ("),
          locale:  v.Locale,
          lang,
          country: country || "",
          countryName: countryName(country || lang),
          langName:    langName(lang),
          gender:  v.Gender,
        };
      });
    }

    // Apply filter
    if (langFilter) voices = voices.filter((v) => v.lang === langFilter);

    // Group by language
    const byLang: Record<string, { code: unknown; name: unknown; voices: Record<string, unknown>[] }> = {};
    for (const v of voices) {
      const key = v.lang as string;
      if (!byLang[key]) byLang[key] = { code: key, name: v.langName, voices: [] };
      byLang[key].voices.push(v);
    }

    // Sorted language list
    const languages = Object.values(byLang).sort((a, b) => (a.name as string).localeCompare(b.name as string));

    return NextResponse.json({ voices, languages, byLang });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to fetch voices" }, { status: 502 });
  }
}
