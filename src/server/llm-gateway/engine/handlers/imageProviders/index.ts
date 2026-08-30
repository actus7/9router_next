// Image provider adapter registry
import createOpenAIAdapter from "./openai";
import gemini from "./gemini";
import codex from "./codex";
import huggingface from "./huggingface";
import nanobanana from "./nanobanana";
import falAi from "./falAi";
import stabilityAi from "./stabilityAi";
import blackForestLabs from "./blackForestLabs";
import runwayml from "./runwayml";
import cloudflareAi from "./cloudflareAi";
import antigravity from "./antigravity";

/* eslint-disable @typescript-eslint/no-explicit-any */
const ADAPTERS: Record<string, {
  noAuth?: boolean;
  useExecutor?: boolean;
  async?: boolean;
  stream?: boolean;
  buildUrl: (...args: any[]) => string;
  buildHeaders: (...args: any[]) => Record<string, string>;
  buildBody: (...args: any[]) => any;
  normalize: (...args: any[]) => any;
  parseResponse?: (...args: any[]) => any;
  executeViaExecutor?: (...args: any[]) => any;
}> = {
/* eslint-enable @typescript-eslint/no-explicit-any */
  openai: createOpenAIAdapter("openai"),
  minimax: createOpenAIAdapter("minimax"),
  openrouter: createOpenAIAdapter("openrouter"),
  recraft: createOpenAIAdapter("recraft"),
  "vercel-ai-gateway": createOpenAIAdapter("vercel-ai-gateway"),
  xai: createOpenAIAdapter("xai"),
  gemini,
  codex,
  huggingface,
  nanobanana,
  antigravity,
  "fal-ai": falAi,
  "stability-ai": stabilityAi,
  "black-forest-labs": blackForestLabs,
  runwayml,
  "cloudflare-ai": cloudflareAi,
};

export function getImageAdapter(provider: string) {
  return ADAPTERS[provider] || null;
}

export function isImageProvider(provider: string): boolean {
  return provider in ADAPTERS;
}
