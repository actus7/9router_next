"use client";

import { Badge } from "@/components/ui/badge";
import {
  DynamicMedia,
  isSupportedMediaSource,
} from "@/components/ui/dynamic-media";
import { ChevronRight, Wrench } from "lucide-react";
import type { ToolCall } from "../types";

type ToolMedia = { kind: "image" | "audio" | "video"; url: string };

/** Pretty-prints a JSON string for the IN/OUT trace; falls back to the raw text when it isn't JSON. */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Parses a completed media-tool result into a renderable image/audio/video, or null. */
function extractToolMedia(tc: ToolCall): ToolMedia | null {
  if (!tc.result || tc.status !== "done") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(tc.result);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  if (tc.name === "generate_image") {
    const data = obj.data as Array<Record<string, unknown>> | undefined;
    const url = data?.[0]?.url;
    if (typeof url === "string" && isSupportedMediaSource(url))
      return { kind: "image", url };
    const b64 = data?.[0]?.b64_json;
    if (typeof b64 === "string" && b64)
      return { kind: "image", url: `data:image/png;base64,${b64}` };
    return null;
  }
  if (
    tc.name === "text_to_speech" &&
    typeof obj.audioUrl === "string" &&
    obj.audioUrl.startsWith("data:audio/")
  ) {
    return { kind: "audio", url: obj.audioUrl };
  }
  if (
    tc.name === "generate_video" &&
    obj.ok === true &&
    typeof obj.url === "string" &&
    isSupportedMediaSource(obj.url)
  ) {
    return { kind: "video", url: obj.url };
  }
  return null;
}

interface ToolCallListProps {
  toolCalls: ToolCall[];
  compact: boolean;
}

/** Inline "Tool call" trace: a compact done-count summary, or one expandable IN/OUT card per call. */
export default function ToolCallList({ toolCalls, compact }: ToolCallListProps) {
  const doneCount = toolCalls.filter((tc) => tc.status === "done").length;

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {compact && doneCount > 0 ? (
        <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Wrench className="size-3.5" />
          {doneCount} ferramenta{doneCount === 1 ? "" : "s"} concluída
          {doneCount === 1 ? "" : "s"}
        </p>
      ) : null}
      {toolCalls.map((tc) => {
        const media = extractToolMedia(tc);
        if (compact && tc.status === "done" && !media) return null;
        return (
          <details
            key={tc.id}
            className="group/tool rounded-lg border border-border bg-muted/40"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/tool:rotate-90" />
              <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">
                {tc.name}
              </span>
              <Badge
                variant={
                  tc.status === "done"
                    ? "default"
                    : tc.status === "error"
                      ? "destructive"
                      : "secondary"
                }
                className="text-[9px] px-1.5 py-0"
              >
                {tc.status || "pending"}
              </Badge>
            </summary>
            <div className="border-t border-border px-3.5 py-2.5">
              {media?.kind === "image" && (
                <DynamicMedia
                  src={media.url}
                  alt=""
                  className="mb-2 max-h-64 rounded-lg border border-border object-contain"
                />
              )}
              {media?.kind === "audio" && (
                <audio controls src={media.url} className="mb-2 w-full" />
              )}
              {media?.kind === "video" && (
                <video
                  controls
                  src={media.url}
                  className="mb-2 max-h-64 w-full rounded-lg border border-border"
                />
              )}
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Entrada
              </p>
              <pre className="mb-2.5 max-h-40 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                {prettyJson(tc.arguments)}
              </pre>
              {tc.result && (
                <>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Saída
                  </p>
                  <pre className="max-h-40 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                    {prettyJson(tc.result)}
                  </pre>
                </>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
