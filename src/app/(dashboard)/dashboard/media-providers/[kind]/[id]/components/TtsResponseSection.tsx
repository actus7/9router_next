"use client";

import { Button } from "@/components/ui/button";
import { Check, Copy, Download, Play } from "lucide-react";
import type { useTtsFormState } from "./useTtsFormState";

const DEFAULT_TTS_RESPONSE_EXAMPLE = `// Audio will appear here after running.
// Example JSON response (response_format=json):
{
  "format": "mp3",
  "audio": "//NExAANaAIIAUAAANNNNNNNN..." // base64 encoded MP3
}`;

type TtsFormState = ReturnType<typeof useTtsFormState>;

export default function TtsResponseSection({ state }: { state: TtsFormState }) {
  const {
    curlSnippet, copiedCurl, copyCurl,
    handleRun, running, input, modelFull,
    error, audioUrl, latency, jsonResponse,
  } = state;

  return (
    <>
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
    </>
  );
}
