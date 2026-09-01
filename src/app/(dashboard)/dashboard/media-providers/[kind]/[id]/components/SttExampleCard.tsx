"use client";

import { useState, useEffect } from "react";
import { Card } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { getProviderAlias } from "@/shared/constants/providers";
import { getModelKind } from "@/shared/constants/models";
import { getModelsByProviderId } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { Row } from "./exampleShared";
import { Check, Copy, Play, Wifi } from "lucide-react";

export function SttExampleCard({ providerId }: { providerId: string }) {
  const providerAlias = getProviderAlias(providerId);
  const builtinSttModels = (getModelsByProviderId(providerId) as Array<{ id: string; name: string; params?: string[] }>).filter((m) => getModelKind(m) === "stt");
  const [customSttModels, setCustomSttModels] = useState<Array<{ id: string; name: string; params?: string[]; providerAlias?: string }>>([]);
  const sttModels = [...builtinSttModels, ...customSttModels];

  const [selectedModel, setSelectedModel] = useState(builtinSttModels[0]?.id ?? "");
  const selectedModelObj = sttModels.find((m) => m.id === selectedModel);
  const allowedParams = Array.isArray(selectedModelObj?.params) ? selectedModelObj.params : [];

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [responseFormat, setResponseFormat] = useState("json");
  const [temperature, setTemperature] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [useTunnel, setUseTunnel] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
  const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();

  useEffect(() => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d) => { setApiKey(((d.keys || []) as Array<{ isActive?: boolean; key: string }>).find((k) => k.isActive !== false)?.key || ""); })
      .catch(() => {});
    fetch("/api/tunnel/status")
      .then((r) => r.json())
      .then((d) => { if (d.publicUrl) setTunnelEndpoint(d.publicUrl); })
      .catch(() => {});
    const loadCustom = () => {
      fetch("/api/models/custom", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          const list = ((d.models || []) as Array<{ id: string; name: string; params?: string[]; providerAlias?: string }>).filter((m) => getModelKind(m) === "stt" && m.providerAlias === providerAlias);
          setCustomSttModels(list);
        })
        .catch(() => {});
    };
    loadCustom();
    window.addEventListener("focus", loadCustom);
    window.addEventListener("customModelChanged", loadCustom);
    return () => {
      window.removeEventListener("focus", loadCustom);
      window.removeEventListener("customModelChanged", loadCustom);
    };
  }, [providerAlias]);

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  const modelFull = selectedModel ? `${providerAlias}/${selectedModel}` : "";

  const curlSnippet = `curl -X POST ${endpoint}/v1/audio/transcriptions \\
  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\
  -F "file=@${audioFile?.name || "audio.mp3"}" \\
  -F "model=${modelFull}"${allowedParams.includes("language") && language ? ` \\\n  -F "language=${language}"` : ""}${allowedParams.includes("response_format") ? ` \\\n  -F "response_format=${responseFormat}"` : ""}${allowedParams.includes("temperature") && temperature ? ` \\\n  -F "temperature=${temperature}"` : ""}${allowedParams.includes("prompt") && prompt ? ` \\\n  -F "prompt=${prompt}"` : ""}`;

  const handleRun = async () => {
    if (!audioFile || !modelFull) return;
    setRunning(true);
    setError("");
    setResult(null);
    const start = Date.now();
    try {
      const fd = new FormData();
      fd.append("file", audioFile);
      fd.append("model", modelFull);
      if (allowedParams.includes("language") && language) fd.append("language", language);
      if (allowedParams.includes("response_format")) fd.append("response_format", responseFormat);
      if (allowedParams.includes("temperature") && temperature) fd.append("temperature", temperature);
      if (allowedParams.includes("prompt") && prompt) fd.append("prompt", prompt);

      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch("/api/v1/audio/transcriptions", { method: "POST", headers, body: fd });
      setLatency(Date.now() - start);
      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? await res.json() : await res.text();
      if (!res.ok) {
        setError(data?.error?.message || data?.error || data || `HTTP ${res.status}`);
        return;
      }
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRunning(false);
    }
  };

  const resultStr = typeof result === "string" ? result : (result ? JSON.stringify(result, null, 2) : `{\n  "text": "Hello world..."\n}`);

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">Example</h2>
      <div className="flex flex-col gap-2.5">
        {/* Model */}
        {sttModels.length > 0 ? (
          <Row label="Model">
            <Select value={selectedModel} onValueChange={(v) => { if (v !== null) setSelectedModel(v); }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {sttModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name || m.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        ) : (
          <Row label="Model">
            <Input
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              placeholder="Enter model id"
              className="w-full px-3 py-1.5 text-sm font-mono"
            />
          </Row>
        )}

        {/* Endpoint */}
        <Row label="Endpoint">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <span className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate">
              {endpoint}/v1/audio/transcriptions
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

        {/* API Key */}
        <Row label="API Key">
          <span className="px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate block">
            {apiKey ? `${apiKey.slice(0, 8)}${"\u2022".repeat(Math.min(20, apiKey.length - 8))}` : <span className="text-text-muted italic">No key configured</span>}
          </span>
        </Row>

        {/* Audio file */}
        <Row label="Audio File">
          <div className="flex flex-col gap-2">
            <Input
              type="file"
              accept="audio/*,video/mp4,.m4a,.mp3,.wav,.ogg,.flac,.webm,.opus"
              onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-text-muted file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border file:border-border file:bg-background file:text-text-main hover:file:bg-sidebar file:cursor-pointer"
            />
            {audioFile && (
              <span className="text-xs text-text-muted font-mono">
                {audioFile.name} · {(audioFile.size / 1024).toFixed(1)} KB
              </span>
            )}
          </div>
        </Row>

        {/* Language (if model supports) */}
        {allowedParams.includes("language") && (
          <Row label="Language">
            <Input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="e.g. en, vi, ja (auto-detect if empty)"
              className="w-full px-3 py-1.5 text-sm font-mono"
            />
          </Row>
        )}

        {/* Prompt (if model supports) */}
        {allowedParams.includes("prompt") && (
          <Row label="Prompt">
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="optional context to improve accuracy"
              className="w-full px-3 py-1.5 text-sm"
            />
          </Row>
        )}

        {/* Temperature (if model supports) */}
        {allowedParams.includes("temperature") && (
          <Row label="Temperature">
            <Input
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="0 - 1 (default 0)"
              className="w-full px-3 py-1.5 text-sm"
            />
          </Row>
        )}

        {/* Response format (if model supports) */}
        {allowedParams.includes("response_format") && (
          <Row label="Response Format">
            <Select value={responseFormat} onValueChange={(v) => { if (v !== null) setResponseFormat(v); }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="json">json</SelectItem>
                <SelectItem value="text">text</SelectItem>
                <SelectItem value="srt">srt</SelectItem>
                <SelectItem value="verbose_json">verbose_json</SelectItem>
                <SelectItem value="vtt">vtt</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        )}

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
                disabled={running || !audioFile || !modelFull}
                className="flex w-full sm:w-auto items-center justify-center gap-1.5"
                size="sm"
              >
                <Play className={`size-4 ${running ? "animate-spin" : ""}`} />
                {running ? "Transcribing..." : "Run"}
              </Button>
            </div>
          </div>
          <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">{curlSnippet}</pre>
        </div>

        {error && <p className="text-xs text-destructive-foreground break-words">{error}</p>}

        {/* Response */}
        <div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Response {result && latency && <span className="font-normal normal-case">&#9889; {latency}ms</span>}
            </span>
            {result && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyRes(resultStr)}
                className="inline-flex items-center gap-1 text-text-muted hover:text-primary"
              >
                {copiedRes ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copiedRes ? "Copied" : "Copy"}
              </Button>
            )}
          </div>
          <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all opacity-70">
            {resultStr}
          </pre>
        </div>
      </div>
    </Card>
  );
}
