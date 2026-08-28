"use client";

import { useState, useEffect } from "react";
import { Card } from "@/shared/components";
import Button from "@/shared/components/Button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { TTS_PROVIDER_CONFIG } from "@/shared/constants/ttsProviders";
import { translate } from "@/i18n/runtime";
import { getTtsVoicesForModel, GOOGLE_TTS_LANGUAGES } from "@/shared/llm-catalog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Row } from "./exampleShared";
import { Check, Copy, Download, Globe, Play, Wifi, X } from "lucide-react";

const DEFAULT_TTS_RESPONSE_EXAMPLE = `// Audio will appear here after running.
// Example JSON response (response_format=json):
{
  "format": "mp3",
  "audio": "//NExAANaAIIAUAAANNNNNNNN..." // base64 encoded MP3
}`;

interface TtsVoice {
  id: string;
  name: string;
  language?: string;
  gender?: string;
  free_users_allowed?: boolean;
}

interface TtsLanguage {
  code: string;
  name: string;
  voices?: TtsVoice[];
}

export function TtsExampleCard({ providerId }: { providerId: string }) {
  const providerAlias = getProviderAlias(providerId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = (TTS_PROVIDER_CONFIG as any)[providerId] || (TTS_PROVIDER_CONFIG as any)["edge-tts"];

  // Voice state
  const [selectedVoice, setSelectedVoice]     = useState(config.defaultVoiceId || "");
  const [selectedVoiceName, setSelectedVoiceName] = useState("");
  const [voiceId, setVoiceId]               = useState(config.defaultVoiceId || ""); // editable voice id (elevenlabs/config providers)
  // Voices shown below Voice row after language selected
  const [countryVoices, setCountryVoices]     = useState<TtsVoice[]>([]);
  const [selectedLang, setSelectedLang]       = useState("");
  const [selectedModel, setSelectedModel]     = useState<string>(() => {
    const cfgModels = (AI_PROVIDERS[providerId]?.ttsConfig as Record<string, unknown> | undefined)?.models as { id: string }[] | undefined;
    if (cfgModels?.length) return cfgModels[0].id;
    if (config.hasModelSelector && config.modelKey) {
      const models = getModelsByProviderId(config.modelKey);
      return (models?.[0]?.id as string) || "";
    }
    return "";
  });

  // Form state
  const [input, setInput]               = useState("Hello, this is a text to speech test.");
  const [style, setStyle]               = useState(""); // style/voice instructions (e.g. MiMo voicedesign)
  const [apiKey, setApiKey]             = useState("");
  const [useTunnel, setUseTunnel]       = useState(false);
  const [localEndpoint, setLocalEndpoint]   = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [responseFormat, setResponseFormat] = useState("mp3"); // mp3 | json
  const [audioUrl, setAudioUrl]         = useState("");
  const [jsonResponse, setJsonResponse] = useState<Record<string, unknown> | null>(null); // Store JSON response
  const [running, setRunning]           = useState(false);
  const [error, setError]               = useState("");
  const [latency, setLatency]           = useState<number | null>(null);
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();

  // Country picker modal state
  const [modalOpen, setModalOpen]           = useState(false);
  const [languages, setLanguages]           = useState<TtsLanguage[]>([]);
  const [modalLoading, setModalLoading]     = useState(false);
  const [modalSearch, setModalSearch]       = useState("");
  const [modalError, setModalError]         = useState("");
  const [byLang, setByLang]                 = useState<Record<string, TtsLanguage & { voices: TtsVoice[] }>>({});
  // Language hint (e.g. Gemini/MiMo): guides the spoken language without affecting voice selection
  const [languageHint, setLanguageHint]     = useState("");
  // Number of stored provider connections (shown when no dashboard API key)
  const [connectionCount, setConnectionCount] = useState(0);

  useEffect(() => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d: Record<string, unknown>) => { setApiKey(((d.keys as Record<string, unknown>[] | undefined) || []).find((k: Record<string, unknown>) => k.isActive !== false)?.key as string || ""); })
      .catch(() => {});
    fetch("/api/providers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Record<string, unknown>) => { setConnectionCount(((d.connections as Record<string, unknown>[] | undefined) || []).filter((c: Record<string, unknown>) => c.provider === providerId && c.isActive !== false).length); })
      .catch(() => {});
    fetch("/api/tunnel/status")
      .then((r) => r.json())
      .then((d) => { if (d.publicUrl) setTunnelEndpoint(d.publicUrl); })
      .catch(() => {});

    // Pre-select default voice based on provider config
    if (config.voiceSource === "hardcoded") {
      const defaultModel = config.hasModelSelector && config.modelKey
        ? ((getModelsByProviderId(config.modelKey)?.[0]?.id as string) || "")
        : "";
      // Use per-model voices if available, else flat list
      const voices: TtsVoice[] = (config.voicesPerModel && defaultModel)
        ? ((getTtsVoicesForModel(providerId, defaultModel) || []) as TtsVoice[])
        : (getModelsByProviderId(config.voiceKey || providerId).filter((m) => getModelKind(m) === "tts") as unknown as TtsVoice[]);
      if (voices.length) {
        if (config.hasBrowseButton) {
          // Google TTS: pre-select "en" (English) as default, show as single voice chip
          const defaultVoice = voices.find((v) => v.id === "en") || voices[0];
          setSelectedLang(defaultVoice.id);
          setSelectedVoice(defaultVoice.id);
          setSelectedVoiceName(defaultVoice.name);
          setCountryVoices([{ id: defaultVoice.id, name: defaultVoice.name }]);
        } else {
          // OpenAI/OpenRouter: set voice chips directly (no language picker)
          setCountryVoices(voices);
          setSelectedVoice(voices[0].id);
          setSelectedVoiceName(voices[0].name || voices[0].id);
        }
      }
    }
    // api-language (edge-tts, local-device, elevenlabs): NO default load, wait for user to pick language
    // config (nvidia, hyperbolic, deepgram, huggingface, cartesia, playht, coqui, tortoise, inworld, qwen):
    // use ttsConfig.models for model selector; voice is empty by default (backend uses provider default)
  }, [providerId]);

  // Update voices when model changes (voicesPerModel providers)
  useEffect(() => {
    if (!config.voicesPerModel || !selectedModel) return;
    const voices = (getTtsVoicesForModel(providerId, selectedModel) || []) as TtsVoice[];
    setCountryVoices(voices);
    if (voices.length) {
      setSelectedVoice(voices[0].id);
      setSelectedVoiceName(voices[0].name || voices[0].id);
    } else {
      // Model has no preset voices (voicedesign/voiceclone) — drop stale voice
      setSelectedVoice("");
      setSelectedVoiceName("");
    }
  }, [selectedModel]);

  // Open modal — load language list
  const openModal = async () => {
    setModalOpen(true);
    setModalSearch("");
    setModalError("");
    if (languages.length) return; // already loaded
    setModalLoading(true);
    try {
      if (config.voiceSource === "hardcoded") {
        // Build languages/byLang from static providerModels data
        const voiceKey = config.voiceKey || providerId;
        const voices = getModelsByProviderId(voiceKey).filter((m) => getModelKind(m) === "tts") as Record<string, unknown>[];
        const byLangMap: Record<string, TtsLanguage & { voices: TtsVoice[] }> = {};
        for (const v of voices) {
          const vId = v.id as string;
          const vName = v.name as string;
          if (!byLangMap[vId]) byLangMap[vId] = { code: vId, name: vName, voices: [{ id: vId, name: vName }] };
        }
        setByLang(byLangMap);
        setLanguages(Object.values(byLangMap).sort((a, b) => a.name.localeCompare(b.name)));
      } else {
        // Use provider-specific apiEndpoint if available, else default to edge-tts voices API
        const url = config.apiEndpoint
          ? config.apiEndpoint
          : `/api/media-providers/tts/voices?provider=${providerId === "local-device" ? "local-device" : "edge-tts"}`;
        const r = await fetch(url);
        const d = await r.json() as Record<string, unknown>;
        if (d.error) { setModalError(d.error as string); return; }
        setLanguages((d.languages || []) as TtsLanguage[]);
        setByLang((d.byLang || {}) as Record<string, TtsLanguage & { voices: TtsVoice[] }>);
      }
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setModalLoading(false);
    }
  };

  // Click language → close modal → show voices below
  const handlePickLanguage = (lang: TtsLanguage) => {
    setModalOpen(false);
    setSelectedLang(lang.code);
    const voices = byLang[lang.code]?.voices || [];
    setCountryVoices(voices);
    // Auto-select first voice
    if (voices.length) {
      setSelectedVoice(voices[0].id);
      setSelectedVoiceName(voices[0].name);
      if (config.hasVoiceIdInput) setVoiceId(voices[0].id);
    }
  };

  const filteredLanguages = modalSearch
    ? languages.filter((c) =>
        c.name.toLowerCase().includes(modalSearch.toLowerCase()) ||
        c.code.toLowerCase().includes(modalSearch.toLowerCase())
      )
    : languages;

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  // For ElevenLabs/config-driven: prefer manual voiceId (if any), else fall back to selectedVoice
  const activeVoiceId = config.hasVoiceIdInput ? (voiceId || selectedVoice) : selectedVoice;
  const modelFull = (() => {
    if (config.hasModelSelector && selectedModel && activeVoiceId) return `${providerAlias}/${selectedModel}/${activeVoiceId}`;
    if (config.hasModelSelector && selectedModel) return `${providerAlias}/${selectedModel}`;
    if (activeVoiceId) return `${providerAlias}/${activeVoiceId}`;
    return "";
  })();

  const ttsBody = (() => {
    const b: Record<string, string> = { model: modelFull, input };
    if (config.hasLanguageHint && languageHint) b.language = languageHint;
    if (config.hasStyleInput && style.trim()) b.style = style.trim();
    return b;
  })();
  const curlSnippet = `curl -X POST ${endpoint}/v1/audio/speech${responseFormat === "json" ? "?response_format=json" : ""} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\
  -d '${JSON.stringify(ttsBody)}' \\
  ${responseFormat === "json" ? "" : "--output speech.mp3"}`;

  const handleRun = async () => {
    if (!input.trim() || !modelFull) return;
    setRunning(true);
    setError("");
    setAudioUrl("");
    setJsonResponse(null);
    const start = Date.now();
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const url = `/api/v1/audio/speech${responseFormat === "json" ? "?response_format=json" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...ttsBody, input: input.trim() }),
      });
      setLatency(Date.now() - start);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error?.message || d?.error || `HTTP ${res.status}`);
        return;
      }
      
      if (responseFormat === "json") {
        const data = await res.json();
        setJsonResponse(data); // Store full JSON response
        const format = data.format || "mp3";
        const audioBlob = await fetch(`data:audio/${format};base64,${data.audio}`).then(r => r.blob());
        setAudioUrl(URL.createObjectURL(audioBlob));
      } else {
        const blob = await res.blob();
        setAudioUrl(URL.createObjectURL(blob));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Card>
        <h2 className="text-lg font-semibold mb-4">Example</h2>

        <div className="flex flex-col gap-2.5">
          {/* Endpoint + API Key as read-only text */}
          <Row label="Endpoint">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <span className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate">
                {endpoint}/v1/audio/speech
              </span>
              {tunnelEndpoint && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUseTunnel((v) => !v)}
                  title={useTunnel ? "Using tunnel" : "Using local"}
                  className={`flex items-center gap-1 shrink-0 ${
                    useTunnel ? "border-primary/40 bg-primary/10 text-primary" : "text-text-muted hover:text-primary"
                  }`}
                >
                  <Wifi className="size-4" />
                  Tunnel
                </Button>
              )}
            </div>
          </Row>
          <Row label="API Key">
            <span className="px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate block">
              {apiKey
                ? `${apiKey.slice(0, 8)}${"•".repeat(Math.min(20, apiKey.length - 8))}`
                : connectionCount > 0
                  ? <span className="text-text-muted italic">Using stored key(s) · {connectionCount} connection{connectionCount > 1 ? "s" : ""}</span>
                  : <span className="text-text-muted italic">No key configured</span>}
            </span>
          </Row>

          {/* Model selector — prefer PROVIDER_MODELS[kind=tts], else providerModels via modelKey */}
          {config.hasModelSelector && (config.modelKey || getModelsByProviderId(providerId).some(m => getModelKind(m) === "tts")) && (
            <Row label="Model">
              <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const ttsModels = getModelsByProviderId(providerId).filter(m => getModelKind(m) === "tts") as Record<string, unknown>[];
                    return (ttsModels.length ? ttsModels : getModelsByProviderId(config.modelKey) || []).map((m) => (
                      <SelectItem key={String(m.id)} value={String(m.id)}>{String(m.name || m.id)}</SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
            </Row>
          )}

          {/* Language hint dropdown (Gemini, Xiaomi MiMo) — sends body.language to guide pronunciation */}
          {config.hasLanguageHint && (
            <Row label="Language">
              <Select value={languageHint || "__auto__"} onValueChange={(v) => setLanguageHint(v === "__auto__" || v === null ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Auto-detect" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">Auto-detect</SelectItem>
                  {(config.languageOptions || GOOGLE_TTS_LANGUAGES).map((l: string | { id: string; name: string }) =>
                    typeof l === "string"
                      ? <SelectItem key={l} value={l}>{l}</SelectItem>
                      : <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Row>
          )}

          {/* Language row + Browse button (edge-tts, local-device, elevenlabs) */}
          {config.hasBrowseButton && (
            <Row label="Language">
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <Button
                  variant="outline"
                  onClick={openModal}
                  className="w-full min-w-0 flex-1 px-3 py-1.5 font-mono truncate text-left justify-start"
                >
                  {selectedLang
                    ? <span className="text-text-main">{languages.find((l) => l.code === selectedLang)?.name || selectedLang}</span>
                    : <span className="text-text-muted">No language selected</span>}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openModal}
                  className="flex w-full items-center justify-center gap-1 sm:w-auto sm:shrink-0"
                >
                  <Globe className="size-4" />
                  Select language
                </Button>
              </div>
            </Row>
          )}

          {/* Voice chips — shown after language picked (edge-tts, local-device) or always (OpenAI/ElevenLabs/MiMo) */}
          {countryVoices.length > 0 && (
            <Row label="Voice">
              <div className="flex flex-wrap gap-1.5">
                {countryVoices.map((v) => (
                  <Button
                    key={v.id}
                    variant={selectedVoice === v.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setSelectedVoice(v.id);
                      setSelectedVoiceName(v.name);
                      if (config.hasVoiceIdInput) setVoiceId(v.id);
                    }}
                    className={`rounded-full ${
                      selectedVoice === v.id
                        ? "bg-primary/15 border-primary/40 text-primary font-medium"
                        : "text-text-muted hover:text-primary hover:border-primary/40"
                    }`}
                  >
                    {v.name}
                    {v.language ? ` · ${v.language}` : ""}
                    {v.gender ? ` · ${v.gender[0].toUpperCase()}` : ""}
                    {v.free_users_allowed === true && (
                      <span className="ml-1.5 px-1 py-0.5 text-[9px] font-semibold rounded bg-green-500/15 text-green-600 border border-green-500/20">Free</span>
                    )}
                    {v.free_users_allowed === false && (
                      <span className="ml-1.5 px-1 py-0.5 text-[9px] font-semibold rounded bg-amber-500/15 text-amber-600 border border-amber-500/20">Paid</span>
                    )}
                  </Button>
                ))}
              </div>
            </Row>
          )}

          {/* Voice ID input (ElevenLabs) — manual entry or auto-fill from chip */}
          {config.hasVoiceIdInput && (
            <Row label="Voice ID">
              <div className="flex flex-col gap-1">
                <div className="relative">
                  <Input
                    value={voiceId}
                    onChange={(e) => {
                      setVoiceId(e.target.value);
                      setSelectedVoice(e.target.value);
                    }}
                    placeholder="e.g. CwhRBWXzGAHq8TQ4Fs17"
                    className="w-full px-3 py-1.5 pr-7 text-sm font-mono"
                  />
                  {voiceId && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      type="button"
                      onClick={() => { setVoiceId(""); setSelectedVoice(""); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary"
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </Row>
          )}

          {/* Google TTS: Language dropdown */}
          {config.hasLanguageDropdown && (
            <Row label="Language">
              <Select value={selectedVoice} onValueChange={(val) => {
                  const m = getModelsByProviderId(providerId).filter((m) => getModelKind(m) === "tts").find((m) => m.id === val);
                  setSelectedVoice(val);
                  setSelectedVoiceName(m?.name || val);
                }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  {getModelsByProviderId(providerId).filter((m) => getModelKind(m) === "tts").map((m) => (
                    <SelectItem key={String(m.id)} value={String(m.id)}>{String(m.name || m.id)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          )}

          {/* Input */}
          <Row label="Input">
            <div className="relative">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="w-full px-3 py-1.5 pr-7 text-sm"
              />
              {input && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  onClick={() => setInput("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          </Row>

          {/* Style / voice instructions (Xiaomi MiMo) */}
          {config.hasStyleInput && (
            <Row label={translate("Style") || "Style"}>
              <div className="relative">
                <Textarea
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  placeholder={translate("e.g. a warm, gentle voice, speaking slowly with a British accent") ?? undefined}
                  rows={2}
                  className="pr-7 resize-none"
                />
                {style && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    onClick={() => setStyle("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary"
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            </Row>
          )}

          {/* Output Format */}
          <Row label="Output Format">
            <Select value={responseFormat} onValueChange={(v) => setResponseFormat(v ?? "mp3")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mp3">MP3 (Binary)</SelectItem>
                <SelectItem value="json">JSON (Base64)</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          {/* Curl + Run */}
          <div className="mt-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Request</span>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyCurl(curlSnippet)}
                  className="inline-flex items-center gap-1 text-text-muted hover:text-primary"
                >
                  {copiedCurl ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copiedCurl ? "Copied" : "Copy"}
                </Button>
                <Button
                  onClick={handleRun}
                  disabled={running || !input.trim() || !modelFull}
                  className="flex w-full sm:w-auto items-center justify-center gap-1.5"
                  size="sm"
                >
                  <Play className={`size-4 ${running ? "animate-spin" : ""}`} />
                  {running ? "Generating..." : "Run"}
                </Button>
              </div>
            </div>
            <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">{curlSnippet}</pre>
          </div>

          {error && <p className="text-xs text-red-500 break-words">{error}</p>}

          {/* Audio player */}
          {audioUrl ? (
            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Response {latency && <span className="font-normal normal-case">&#9889; {latency}ms</span>}
                </span>
                <a href={audioUrl} download="speech.mp3" className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors">
                  <Download className="size-4" />
                  Download
                </a>
              </div>
              <audio controls src={audioUrl} className="w-full" />
              
              {/* JSON Response (if format is json) */}
              {jsonResponse && (
                <div className="mt-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
                    <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">JSON Response</span>
                  </div>
                  <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify({
                      format: jsonResponse.format,
                      audio: jsonResponse.audio ? `${(jsonResponse.audio as string).substring(0, 100)}...` : ""
                    }, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div>
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Response</span>
            <pre className="mt-1.5 bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all opacity-50">{DEFAULT_TTS_RESPONSE_EXAMPLE}</pre>
          </div>
          )}
        </div>
      </Card>

      {/* Country Picker Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }}
          onClick={() => setModalOpen(false)}
        >
          <div
            className="border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[80vh]"
            style={{ backgroundColor: "var(--color-bg)", isolation: "isolate" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 rounded-t-xl">
              <h3 className="text-sm font-semibold">Select Language</h3>
              <Button variant="ghost" size="icon" onClick={() => setModalOpen(false)} className="text-text-muted hover:text-primary">
                <X className="size-5" />
              </Button>
            </div>

            {/* Search */}
            <div className="px-4 py-2.5 border-b border-border shrink-0">
              <Input
                autoFocus
                value={modalSearch}
                onChange={(e) => setModalSearch(e.target.value)}
                placeholder="Search language..."
                className="w-full px-3 py-1.5 text-sm"
              />
            </div>

            {/* Language list */}
            <div className="overflow-y-auto flex-1 p-2">
              {modalError && <p className="text-xs text-red-500 px-2 py-1">{modalError}</p>}
              {modalLoading ? (
                <p className="text-xs text-text-muted px-2 py-3">Loading...</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {filteredLanguages.map((c) => (
                    <Button
                      key={c.code}
                      variant="ghost"
                      onClick={() => handlePickLanguage(c)}
                      className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-left justify-start ${
                        selectedLang === c.code ? "bg-primary/10 text-primary" : ""
                      }`}
                    >
                      <span className="text-sm">{c.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-text-muted">{c.voices?.length ?? 0} voices</span>
                        {selectedLang === c.code && (
                          <Check className="size-4" />
                        )}
                      </div>
                    </Button>
                  ))}
                  {filteredLanguages.length === 0 && (
                    <p className="text-xs text-text-muted px-2 py-3">No languages found.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
