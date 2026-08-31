"use client";

import { useState, useEffect } from "react";
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { TTS_PROVIDER_CONFIG, type TtsProviderEntry } from "@/shared/constants/ttsProviders";
import { getTtsVoicesForModel } from "@/shared/llm-catalog";

export interface TtsVoice {
  id: string;
  name: string;
  language?: string;
  gender?: string;
  free_users_allowed?: boolean;
}

export interface TtsLanguage {
  code: string;
  name: string;
  voices?: TtsVoice[];
}

function getConfig(providerId: string): TtsProviderEntry {
  const configs = TTS_PROVIDER_CONFIG as unknown as Record<string, TtsProviderEntry>;
  return configs[providerId] || configs["edge-tts"];
}

export function useTtsFormState({ providerId }: { providerId: string }) {
  const providerAlias = getProviderAlias(providerId);
  const config = getConfig(providerId);

  // Voice state
  const [selectedVoice, setSelectedVoice]     = useState(config.defaultVoiceId || "");
  const [selectedVoiceName, setSelectedVoiceName] = useState("");
  const [voiceId, setVoiceId]               = useState(config.defaultVoiceId || "");
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
  const [style, setStyle]               = useState("");
  const [apiKey, setApiKey]             = useState("");
  const [useTunnel, setUseTunnel]       = useState(false);
  const [localEndpoint, setLocalEndpoint]   = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [responseFormat, setResponseFormat] = useState("mp3");
  const [audioUrl, setAudioUrl]         = useState("");
  const [jsonResponse, setJsonResponse] = useState<Record<string, unknown> | null>(null);
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
  const [languageHint, setLanguageHint]     = useState("");
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

    if (config.voiceSource === "hardcoded") {
      const defaultModel = config.hasModelSelector && config.modelKey
        ? ((getModelsByProviderId(config.modelKey)?.[0]?.id as string) || "")
        : "";
      const voices: TtsVoice[] = (config.voicesPerModel && defaultModel)
        ? ((getTtsVoicesForModel(providerId, defaultModel) || []) as TtsVoice[])
        : (getModelsByProviderId(config.voiceKey || providerId).filter((m) => getModelKind(m) === "tts") as unknown as TtsVoice[]);
      if (voices.length) {
        if (config.hasBrowseButton) {
          const defaultVoice = voices.find((v) => v.id === "en") || voices[0];
          setSelectedLang(defaultVoice.id);
          setSelectedVoice(defaultVoice.id);
          setSelectedVoiceName(defaultVoice.name);
          setCountryVoices([{ id: defaultVoice.id, name: defaultVoice.name }]);
        } else {
          setCountryVoices(voices);
          setSelectedVoice(voices[0].id);
          setSelectedVoiceName(voices[0].name || voices[0].id);
        }
      }
    }
  }, [providerId]);

  useEffect(() => {
    if (!config.voicesPerModel || !selectedModel) return;
    const voices = (getTtsVoicesForModel(providerId, selectedModel) || []) as TtsVoice[];
    setCountryVoices(voices);
    if (voices.length) {
      setSelectedVoice(voices[0].id);
      setSelectedVoiceName(voices[0].name || voices[0].id);
    } else {
      setSelectedVoice("");
      setSelectedVoiceName("");
    }
  }, [selectedModel]);

  const openModal = async () => {
    setModalOpen(true);
    setModalSearch("");
    setModalError("");
    if (languages.length) return;
    setModalLoading(true);
    try {
      if (config.voiceSource === "hardcoded") {
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

  const handlePickLanguage = (lang: TtsLanguage) => {
    setModalOpen(false);
    setSelectedLang(lang.code);
    const voices = byLang[lang.code]?.voices || [];
    setCountryVoices(voices);
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
        setJsonResponse(data);
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

  return {
    config, providerAlias, providerId,
    // Voice state
    selectedVoice, setSelectedVoice,
    selectedVoiceName, setSelectedVoiceName,
    voiceId, setVoiceId,
    countryVoices, setCountryVoices,
    selectedLang, setSelectedLang,
    selectedModel, setSelectedModel,
    // Form state
    input, setInput,
    style, setStyle,
    apiKey,
    useTunnel, setUseTunnel,
    localEndpoint, tunnelEndpoint,
    responseFormat, setResponseFormat,
    audioUrl,
    jsonResponse,
    running,
    error,
    latency,
    copiedCurl, copyCurl,
    // Modal state
    modalOpen, setModalOpen,
    languages,
    modalLoading,
    modalSearch, setModalSearch,
    modalError,
    filteredLanguages,
    byLang,
    languageHint, setLanguageHint,
    connectionCount,
    // Derived
    endpoint,
    activeVoiceId,
    modelFull,
    ttsBody,
    curlSnippet,
    // Handlers
    openModal,
    handlePickLanguage,
    handleRun,
  };
}
