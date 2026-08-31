import { NextRequest, NextResponse  } from "next/server";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
const MINIMAX_VOICE_ENDPOINTS = {
  minimax: "https://api.minimax.io/v1/get_voice",
  "minimax-cn": "https://api.minimaxi.com/v1/get_voice",
};

const VOICE_GROUPS = [
  { key: "system_voice", label: "System" },
  { key: "voice_cloning", label: "Cloned" },
  { key: "voice_generation", label: "Generated" },
  { key: "music_generation", label: "Music" },
];

function inferLanguage(voiceId: string) {
  const value = typeof voiceId === "string" ? voiceId.trim() : "";
  if (!value.includes("_")) return "Custom";
  return value.split("_")[0] || "Custom";
}

function addVoice(byLang: Record<string, Record<string, unknown>>, code: string, voice: Record<string, unknown>) {
  if (!byLang[code]) byLang[code] = { code, name: code, voices: [] };
  if ((byLang[code].voices as Array<Record<string, unknown>>).some((v: Record<string, unknown>) => v.id === voice.id)) return;
  (byLang[code].voices as Array<Record<string, unknown>>).push(voice);
}

function normalizeMiniMaxVoices(data: Record<string, unknown>) {
  const byLang: Record<string, Record<string, unknown>> = {};

  for (const group of VOICE_GROUPS) {
    const voices = Array.isArray(data?.[group.key]) ? data[group.key] as Array<Record<string, unknown>> : [];
    for (const item of voices) {
      const voiceId = item?.voice_id || item?.voiceId;
      if (!voiceId) continue;

      const voiceName = item?.voice_name || item?.voiceName || voiceId;
      const lang = group.key === "system_voice" ? inferLanguage(voiceId as string) : "Custom";
      addVoice(byLang, lang, {
        id: voiceId,
        name: group.key === "system_voice" ? voiceName : `${voiceName} · ${group.label}`,
        lang,
        category: group.key,
      });
    }
  }

  const languages = Object.values(byLang).sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    if (a.code === "Custom") return 1;
    if (b.code === "Custom") return -1;
    return (a.name as string).localeCompare(b.name as string);
  });

  for (const lang of languages) {
    (lang.voices as Array<Record<string, unknown>>).sort((a: Record<string, unknown>, b: Record<string, unknown>) => (a.name as string).localeCompare(b.name as string));
  }

  return { languages, byLang };
}

/**
 * GET /api/media-providers/tts/minimax/voices[?provider=minimax|minimax-cn&voice_type=all]
 * Returns { languages, byLang } grouped for the shared TTS voice picker.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") === "minimax-cn" ? "minimax-cn" : "minimax";
    const voiceType = searchParams.get("voice_type") || "all";
    const langFilter = searchParams.get("lang");

    const connections = await getProviderConnections({ provider, isActive: true });
    const apiKey = connections[0]?.apiKey;
    if (!apiKey) {
      return NextResponse.json({ error: `No ${provider} connection found` }, { status: 400 });
    }

    const res = await fetch(MINIMAX_VOICE_ENDPOINTS[provider], {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ voice_type: voiceType }),
    });

    const rawText = await res.text();
    let data: Record<string, unknown> = {};
    if (rawText) {
      try { data = JSON.parse(rawText); } catch { data = {}; }
    }

    const baseResp = (data.base_resp || data.baseResp || {}) as Record<string, unknown>;
    const statusCode = Number(baseResp.status_code ?? baseResp.statusCode ?? 0);
    const statusMessage = baseResp.status_msg || baseResp.statusMsg || data.message || "";

    if (!res.ok) {
      return NextResponse.json({ error: `MiniMax API ${res.status}: ${statusMessage || rawText || "Failed"}` }, { status: 502 });
    }
    if (statusCode !== 0) {
      return NextResponse.json({ error: statusMessage || "MiniMax voice API error" }, { status: 502 });
    }

    const normalized = normalizeMiniMaxVoices(data);
    if (langFilter) {
      return NextResponse.json({ voices: (normalized.byLang[langFilter]?.voices as Array<unknown>) || [] });
    }

    return NextResponse.json(normalized);
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message || "Failed to fetch MiniMax voices" }, { status: 502 });
  }
}
