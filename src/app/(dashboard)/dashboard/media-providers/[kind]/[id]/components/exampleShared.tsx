"use client";

import React from "react";

interface RowProps {
  label: string;
  children: React.ReactNode;
}

export function Row({ label, children }: RowProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="shrink-0 text-xs font-medium text-text-muted sm:w-28">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

interface ExtraField {
  key: string;
  label: string;
  placeholder?: string;
  type?: string;
  options?: string[];
  default?: string | number;
  min?: number;
  max?: number;
}

export interface KindExampleConfigItem {
  title: string;
  description: string;
  fields: { key: string; label: string; placeholder?: string }[];
  extraFields?: ExtraField[];
  outputLabel?: string;
  defaultInput?: string;
  bodyKey?: string;
  extraBody?: Record<string, unknown>;
  defaultResponse?: string;
  inputLabel?: string;
  inputPlaceholder?: string;
}

export const KIND_EXAMPLE_CONFIG: Record<string, KindExampleConfigItem> = {
  tts: {
    title: "Text-to-Speech",
    description: "Convert text to spoken audio",
    fields: [{ key: "input", label: "Text", placeholder: "Hello, world!" }],
    outputLabel: "Audio",
  },
  stt: {
    title: "Speech-to-Text",
    description: "Transcribe audio to text",
    fields: [{ key: "audio", label: "Audio URL", placeholder: "https://example.com/audio.mp3" }],
    outputLabel: "Transcription",
  },
  embedding: {
    title: "Embeddings",
    description: "Generate text embeddings",
    fields: [{ key: "input", label: "Text", placeholder: "Hello, world!" }],
    outputLabel: "Embedding",
  },
  image: {
    title: "Image Generation",
    description: "Generate images from text prompts",
    fields: [{ key: "prompt", label: "Prompt", placeholder: "A sunset over the ocean" }],
    outputLabel: "Image",
  },
  video: {
    title: "Video Generation",
    description: "Generate videos from text prompts",
    fields: [{ key: "prompt", label: "Prompt", placeholder: "A cat walking on the beach" }],
    outputLabel: "Video",
  },
  music: {
    title: "Music Generation",
    description: "Generate music from text prompts",
    fields: [{ key: "prompt", label: "Prompt", placeholder: "A calm piano melody" }],
    outputLabel: "Music",
  },
};
