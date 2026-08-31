import { NextRequest, NextResponse  } from "next/server";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { fetchElevenLabsVoices } from "@/server/llm-gateway/media";

const langNames = new Intl.DisplayNames(["en"], { type: "language" });

/**
 * GET /api/media-providers/tts/elevenlabs/voices[?lang=en]
 * Returns { languages, byLang } grouped by language - same format as edge-tts
 * Uses direct DB read (no mutex) to avoid blocking on concurrent TTS requests
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const langFilter = searchParams.get("lang");

    // Direct DB read - bypass auth mutex used for TTS inference
    const connections = await getProviderConnections({ provider: "elevenlabs", isActive: true });
    const apiKey = connections[0]?.apiKey as string;
    if (!apiKey) {
      return NextResponse.json({ error: "No ElevenLabs connection found" }, { status: 400 });
    }

    const voices = await fetchElevenLabsVoices(apiKey);

    // Group by all supported languages (verified_languages + labels.language)
    const byLang: Record<string, Record<string, unknown>> = {};
    const addToLang = (code: string, voice: Record<string, unknown>) => {
      if (!byLang[code]) {
        byLang[code] = {
          code,
          name: (() => { try { return langNames.of(code); } catch { return code; } })(),
          voices: [],
        };
      }
      // Avoid duplicate voice in same lang
      if (!(byLang[code].voices as Array<Record<string, unknown>>).find((v: Record<string, unknown>) => v.id === (voice as Record<string, unknown>).voice_id)) {
        (byLang[code].voices as Array<Record<string, unknown>>).push({
          id: voice.voice_id,
          name: voice.name,
          gender: (voice.labels as Record<string, unknown>)?.gender || "",
          lang: code,
          // premade voices are free; professional library voices added to account may require paid plan
          free_users_allowed: voice.category === "premade" || voice.is_owner === true
        });
      }
    };
    for (const v of voices) {
      // Add to primary language
      const primaryLang = (v as Record<string, unknown>).labels ? ((v as Record<string, unknown>).labels as Record<string, unknown>).language as string || "en" : "en";
      addToLang(primaryLang, v as Record<string, unknown>);
      // Add to all verified languages
      for (const vl of (v as Record<string, unknown>).verified_languages as Array<Record<string, unknown>> || []) {
        if (vl.language && vl.language !== primaryLang) {
          addToLang(vl.language as string, v as Record<string, unknown>);
        }
      }
    }

    const languages = Object.values(byLang).sort((a: Record<string, unknown>, b: Record<string, unknown>) => (a.name as string).localeCompare(b.name as string));

    // If lang filter requested, return only that group's voices
    if (langFilter) {
      return NextResponse.json({ voices: (byLang[langFilter]?.voices as Array<unknown>) || [] });
    }

    return NextResponse.json({ languages, byLang });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message || "Failed to fetch voices" }, { status: 502 });
  }
}
