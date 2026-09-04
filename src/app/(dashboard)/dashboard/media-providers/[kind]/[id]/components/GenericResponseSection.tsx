"use client";

import { Button } from "@/components/ui/button";
import { DynamicMedia } from "@/shared/components/DynamicMedia";
import { Check, CheckCircle2, Copy, Download, Loader2, Play } from "lucide-react";
import type { useGenericExampleState } from "./useGenericExampleState";

type GenericState = ReturnType<typeof useGenericExampleState>;
type NonNullGenericState = NonNullable<GenericState>;

export default function GenericResponseSection({ state }: { state: NonNullGenericState }) {
  const {
    curlSnippet, copiedCurl, copyCurl,
    handleRun, running, input, modelFull,
    useStreaming, progress, partialImage,
    error, result, resultJson, copiedRes, copyRes,
    kind, binaryImageUrl,
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
              size="xs"
              onClick={() => copyCurl(curlSnippet)}
              className="text-text-muted hover:text-primary"
            >
              {copiedCurl ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copiedCurl ? "Copied" : "Copy"}
            </Button>
          <Button
            onClick={handleRun}
            disabled={running || !input.trim() || !modelFull}
            size="sm"
            className="w-full sm:w-auto"
          >
              <Play className={`size-4 ${running ? "animate-spin" : ""}`} />
              {running ? "Running..." : "Run"}
            </Button>
          </div>
        </div>
        <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">{curlSnippet}</pre>
      </div>

      {/* Streaming progress */}
      {(running || progress) && useStreaming && (
        <div className="flex flex-col gap-2 px-3 py-2 rounded-lg bg-sidebar border border-border sm:flex-row sm:items-center sm:gap-3">
          {running ? <Loader2 className="size-4 text-primary animate-spin" /> : <CheckCircle2 className="size-4 text-primary" />}
          <span className="text-xs text-text-muted">
            {progress?.stage || "starting"}
            {!running && progress?.bytesReceived ? ` · ${(progress.bytesReceived / 1024).toFixed(1)} KB` : ""}
          </span>
        </div>
      )}

      {/* Partial image preview (codex stream) */}
      {partialImage?.b64_json && !result && (
        <div>
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Partial preview</span>
          <DynamicMedia
            src={`data:image/png;base64,${partialImage.b64_json}`}
            alt="Partial"
            className="max-w-full rounded-lg border border-border mt-1.5 opacity-80"
          loading="lazy"
          decoding="async"
          />
        </div>
      )}

      {/* Error */}
      {error && <p className="text-xs text-destructive-foreground break-words">{error}</p>}

      {/* Response */}
      <div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Response {result && <span className="font-normal normal-case">&#9889; {result.latencyMs}ms</span>}
          </span>
          {result && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => copyRes(resultJson)}
              className="text-text-muted hover:text-primary"
            >
              {copiedRes ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copiedRes ? "Copied" : "Copy"}
            </Button>
          )}
        </div>
        <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all opacity-70">
          {result ? resultJson : state.exConfig.defaultResponse}
        </pre>
        {kind === "image" && (binaryImageUrl || (result?.data?.data as Record<string, unknown>[] | undefined)?.[0]) && (
          <div className="mt-2">
            <div className="flex items-center justify-end mb-1.5">
              <a
                href={binaryImageUrl || ((result?.data?.data as Record<string, unknown>[] | undefined)?.[0]?.b64_json ? `data:image/png;base64,${(result!.data.data as Record<string, unknown>[])[0].b64_json}` : ((result?.data?.data as Record<string, unknown>[] | undefined)?.[0]?.url as string) || "")}
                download="image.png"
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <Download className="size-4" />
                Download
              </a>
            </div>
            <DynamicMedia
              src={binaryImageUrl || ((result?.data?.data as Record<string, unknown>[] | undefined)?.[0]?.b64_json ? `data:image/png;base64,${(result!.data.data as Record<string, unknown>[])[0].b64_json}` : ((result?.data?.data as Record<string, unknown>[] | undefined)?.[0]?.url as string))}
              alt="Generated"
              className="max-w-full rounded-lg border border-border"
            loading="lazy"
            decoding="async"
            />
          </div>
        )}
      </div>
    </>
  );
}
