"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { GOOGLE_TTS_LANGUAGES } from "@/shared/llm-catalog";
import { translate } from "@/i18n/runtime";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Row } from "./exampleShared";
import { Globe, X } from "lucide-react";
import type { useTtsFormState } from "./useTtsFormState";

type TtsFormState = ReturnType<typeof useTtsFormState>;

export default function TtsFormFields({ state }: { state: TtsFormState }) {
  const {
    config, providerId,
    selectedVoice, setSelectedVoice, setSelectedVoiceName,
    voiceId, setVoiceId,
    countryVoices,
    selectedLang,
    selectedModel, setSelectedModel,
    input, setInput,
    style, setStyle,
    useTunnel, setUseTunnel,
    endpoint, tunnelEndpoint,
    responseFormat, setResponseFormat,
    languageHint, setLanguageHint,
    languages, openModal,
    apiKey, connectionCount,
  } = state;

  return (
    <>
      {/* Endpoint + API Key */}
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
              <Globe className="size-4" />
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

      {/* Model selector */}
      {config.hasModelSelector && (config.modelKey || getModelsByProviderId(providerId).some(m => getModelKind(m) === "tts")) && (
        <Row label="Model">
          <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {(() => {
                const ttsModels = getModelsByProviderId(providerId).filter(m => getModelKind(m) === "tts") as Record<string, unknown>[];
                return (ttsModels.length ? ttsModels : getModelsByProviderId(config.modelKey ?? providerId) || []).map((m) => (
                  <SelectItem key={String(m.id)} value={String(m.id)}>{String(m.name || m.id)}</SelectItem>
                ));
              })()}
            </SelectContent>
          </Select>
        </Row>
      )}

      {/* Language hint dropdown */}
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

      {/* Language row + Browse button */}
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

      {/* Voice chips */}
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

      {/* Voice ID input */}
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
              const voiceValue = val ?? "";
              setSelectedVoice(voiceValue);
              setSelectedVoiceName(String(m?.name || voiceValue));
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

      {/* Style / voice instructions */}
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
    </>
  );
}
