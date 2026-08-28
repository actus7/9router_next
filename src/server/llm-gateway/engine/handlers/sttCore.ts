import { createErrorResult } from "../utils/error";
import { HTTP_STATUS } from "../config/runtimeConfig";

// Build auth headers from sttConfig + token
function buildAuthHeaders(cfg: Record<string, unknown>, token: string | null): Record<string, string> {
  if (!token) return {};
  switch (cfg.authHeader) {
    case "bearer":     return { "Authorization": `Bearer ${token}` };
    case "token":      return { "Authorization": `Token ${token}` };
    case "x-api-key":  return { "x-api-key": token };
    case "key":        return { "Authorization": `Key ${token}` };
    default:           return { "Authorization": `Bearer ${token}` };
  }
}

// Map browser file MIME / ext → audio MIME for binary formats (deepgram/HF)
function resolveAudioContentType(file: { type?: string; name?: string }): string {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("audio/")) return t;
  const name = typeof file.name === "string" ? file.name.toLowerCase() : "";
  const ext = name.includes(".") ? name.split(".").pop() : "";
  const map: Record<string, string> = { mp3: "audio/mpeg", mp4: "audio/mp4", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", webm: "audio/webm", aac: "audio/aac", opus: "audio/opus" };
  return map[ext || ""] || "application/octet-stream";
}

async function upstreamError(res: Response) {
  let txt = "";
  try { txt = await res.text(); } catch {}
  let msg: string = txt || `Upstream error (${res.status})`;
  try { const j = JSON.parse(txt); msg = j?.error?.message || j?.error || j?.message || msg; } catch {}
  return createErrorResult(res.status, typeof msg === "string" ? msg : JSON.stringify(msg), undefined);
}

// Deepgram: raw binary POST + model query param
async function transcribeDeepgram(cfg: Record<string, unknown>, file: { type?: string; name?: string; arrayBuffer(): Promise<ArrayBuffer> }, model: string, token: string | null, formData: FormData) {
  const url = new URL(cfg.baseUrl as string);
  url.searchParams.set("model", model);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  const lang = formData.get("language");
  if (typeof lang === "string" && lang.trim()) url.searchParams.set("language", lang.trim());
  else url.searchParams.set("detect_language", "true");

  const buf = await file.arrayBuffer();
  const res = await fetch(url, {
    method: "POST",
    headers: { ...buildAuthHeaders(cfg, token), "Content-Type": resolveAudioContentType(file) },
    body: buf,
  });
  if (!res.ok) return upstreamError(res);
  const data = await res.json() as Record<string, unknown>;
  const channels = (data.results as Record<string, unknown>)?.channels as Record<string, unknown>[] | undefined;
  const text = (channels?.[0]?.alternatives as Record<string, unknown>[])?.[0]?.transcript ?? "";
  return jsonResponse({ text });
}

// AssemblyAI: upload → submit → poll (max 120s)
async function transcribeAssemblyAI(cfg: Record<string, unknown>, file: { arrayBuffer(): Promise<ArrayBuffer> }, model: string, token: string | null) {
  const auth = buildAuthHeaders(cfg, token);
  const buf = await file.arrayBuffer();
  const up = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST", headers: { ...auth, "Content-Type": "application/octet-stream" }, body: buf,
  });
  if (!up.ok) return upstreamError(up);
  const { upload_url } = await up.json() as { upload_url: string };

  const sub = await fetch(cfg.baseUrl as string, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ audio_url: upload_url, speech_models: [model], language_detection: true }),
  });
  if (!sub.ok) return upstreamError(sub);
  const { id } = await sub.json() as { id: string };

  const start = Date.now();
  while (Date.now() - start < 120_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${cfg.baseUrl}/${id}`, { headers: auth });
    if (!poll.ok) continue;
    const r = await poll.json() as Record<string, unknown>;
    if (r.status === "completed") return jsonResponse({ text: r.text || "" });
    if (r.status === "error") return createErrorResult(500, (r.error as string) || "AssemblyAI failed", undefined);
  }
  return createErrorResult(504, "AssemblyAI timeout after 120s", undefined);
}

// Nvidia NIM: multipart, normalize response
async function transcribeNvidia(cfg: Record<string, unknown>, file: { name?: string }, model: string, token: string | null) {
  const fd = new FormData();
  fd.append("file", file as unknown as Blob, file.name || "audio.wav");
  fd.append("model", model);
  const res = await fetch(cfg.baseUrl as string, { method: "POST", headers: buildAuthHeaders(cfg, token), body: fd });
  if (!res.ok) return upstreamError(res);
  const data = await res.json() as Record<string, unknown>;
  return jsonResponse({ text: data.text || data.transcript || "" });
}

// Gemini: generateContent with inline_data audio + transcription prompt
async function transcribeGemini(cfg: Record<string, unknown>, file: { type?: string; name?: string; arrayBuffer(): Promise<ArrayBuffer> }, model: string, token: string | null, formData: FormData) {
  const buf = await file.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  const mime = resolveAudioContentType(file);
  const lang = formData.get("language");
  const userPrompt = formData.get("prompt");
  let promptText = userPrompt && typeof userPrompt === "string" && userPrompt.trim()
    ? userPrompt.trim()
    : "Generate a transcript of the speech. Return only the transcribed text, no commentary.";
  if (typeof lang === "string" && lang.trim()) promptText += ` Language: ${lang.trim()}.`;

  const url = `${cfg.baseUrl}/${model}:generateContent?key=${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }, { inline_data: { mime_type: mime, data: b64 } }] }],
    }),
  });
  if (!res.ok) return upstreamError(res);
  const data = await res.json() as Record<string, unknown>;
  const text = (((data?.candidates as Record<string, unknown>[])?.[0]?.content as Record<string, unknown>)?.parts as Record<string, unknown>[])?.map((p: Record<string, unknown>) => p.text).filter(Boolean).join("") || "";
  return jsonResponse({ text });
}

// HuggingFace: POST raw binary to {baseUrl}/{model_id}
async function transcribeHuggingFace(cfg: Record<string, unknown>, file: { type?: string; name?: string; arrayBuffer(): Promise<ArrayBuffer> }, model: string, token: string | null) {
  if (model.includes("..") || model.includes("//")) return createErrorResult(400, "Invalid model ID", undefined);
  const url = `${(cfg.baseUrl as string).replace(/\/+$/, "")}/${model}`;
  const buf = await file.arrayBuffer();
  const res = await fetch(url, {
    method: "POST",
    headers: { ...buildAuthHeaders(cfg, token), "Content-Type": resolveAudioContentType(file) },
    body: buf,
  });
  if (!res.ok) return upstreamError(res);
  const data = await res.json() as Record<string, unknown>;
  return jsonResponse({ text: data.text || "" });
}

// Default: OpenAI/Groq/Whisper-compatible multipart
async function transcribeOpenAICompatible(cfg: Record<string, unknown>, file: { name?: string }, model: string, token: string | null, formData: FormData) {
  const fd = new FormData();
  fd.append("file", file as unknown as Blob, file.name || "audio.wav");
  fd.append("model", model);
  for (const k of ["language", "prompt", "response_format", "temperature"]) {
    const v = formData.get(k);
    if (v !== null && v !== undefined && v !== "") fd.append(k, v);
  }
  const res = await fetch(cfg.baseUrl as string, { method: "POST", headers: buildAuthHeaders(cfg, token), body: fd });
  if (!res.ok) return upstreamError(res);
  const ct = res.headers.get("content-type") || "application/json";
  const txt = await res.text();
  return { success: true, response: new Response(txt, { status: 200, headers: { "Content-Type": ct, "Access-Control-Allow-Origin": "*" } }) };
}

function jsonResponse(obj: Record<string, unknown>) {
  return {
    success: true,
    response: new Response(JSON.stringify(obj), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }),
  };
}

/**
 * STT core handler — dispatch by sttConfig.format.
 * @returns {Promise<{success, response, status?, error?}>}
 */
export async function handleSttCore({ provider, model, formData, credentials, sttConfig }: {
  provider: string;
  model: string;
  formData: FormData;
  credentials: Record<string, unknown>;
  sttConfig: Record<string, unknown> | null;
}) {
  const file = formData.get("file") as unknown as { type?: string; name?: string; arrayBuffer(): Promise<ArrayBuffer> } | null;
  if (!file) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: file", undefined);

  let cfg = sttConfig;
  if (!cfg) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support STT`, undefined);

  // Per-connection endpoint override.
  const overrideUrl = (credentials?.providerSpecificData as Record<string, unknown>)?.baseUrl;
  if (overrideUrl) cfg = { ...cfg, baseUrl: String(overrideUrl).replace(/\/+$/, "") };

  const token = cfg.authType === "none" ? null : ((credentials?.apiKey || credentials?.accessToken) as string) || null;
  if (cfg.authType !== "none" && !token) {
    return createErrorResult(HTTP_STATUS.UNAUTHORIZED, `No credentials for STT provider: ${provider}`, undefined);
  }

  try {
    switch (cfg.format) {
      case "deepgram":        return await transcribeDeepgram(cfg, file, model, token, formData);
      case "assemblyai":      return await transcribeAssemblyAI(cfg, file, model, token);
      case "nvidia-asr":      return await transcribeNvidia(cfg, file, model, token);
      case "huggingface-asr": return await transcribeHuggingFace(cfg, file, model, token);
      case "gemini-stt":      return await transcribeGemini(cfg, file, model, token, formData);
      default:                return await transcribeOpenAICompatible(cfg, file, model, token, formData);
    }
  } catch (err: unknown) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, (err as Error).message || "STT request failed", undefined);
  }
}
