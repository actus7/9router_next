import { describe, expect, it } from "vitest";
import { computeProviderEntries, providerHref } from "@/app/(dashboard)/dashboard/providers/hooks/computeProviderEntries";
import type { ProviderInfo } from "@/app/(dashboard)/dashboard/providers/types";

const ids = (kinds: string[]) => {
  const e = computeProviderEntries("", [], kinds);
  return new Set([...e.oauthEntries, ...e.freeEntries, ...e.freeTierEntries, ...e.apikeyEntries].map(([id]) => id));
};

describe("provider kind chips", () => {
  it("lists media-only providers next to chat providers when no chip is selected", () => {
    const all = ids([]);
    expect(all.has("elevenlabs")).toBe(true);
    expect(all.has("tavily")).toBe(true);
    expect(all.has("openai")).toBe(true);
  });

  it("keeps only providers serving one of the selected kinds", () => {
    const tts = ids(["tts"]);
    expect(tts.has("elevenlabs")).toBe(true);
    expect(tts.has("tavily")).toBe(false);
    const ttsOrSearch = ids(["tts", "webSearch"]);
    expect(ttsOrSearch.has("elevenlabs")).toBe(true);
    expect(ttsOrSearch.has("tavily")).toBe(true);
  });

  it("opens chat providers on the provider page and media ones on their kind page", () => {
    const chat = { serviceKinds: ["llm", "tts"] } as unknown as ProviderInfo;
    const tts = { serviceKinds: ["tts"] } as unknown as ProviderInfo;
    expect(providerHref("openai", chat)).toBe("/dashboard/providers/openai");
    expect(providerHref("openai", chat, ["tts"])).toBe("/dashboard/media-providers/tts/openai");
    expect(providerHref("elevenlabs", tts)).toBe("/dashboard/media-providers/tts/elevenlabs");
    expect(providerHref("legacy", {} as ProviderInfo)).toBe("/dashboard/providers/legacy");
    const gateway = { serviceKinds: ["llm", "image", "systemOne"] } as unknown as ProviderInfo;
    expect(providerHref("vercel-ai-gateway", gateway, ["systemOne"])).toBe("/dashboard/providers/vercel-ai-gateway");
  });

  it("offers System One through the providers that serve it", () => {
    expect(ids(["systemOne"]).has("vercel-ai-gateway")).toBe(true);
    expect(ids(["systemOne"]).has("elevenlabs")).toBe(false);
  });
});
