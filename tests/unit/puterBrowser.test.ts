import { describe, expect, it } from "vitest";
import {
  isPuterBrowserModel,
  PUTER_PROVIDER_ID,
  streamPuterChat,
  toPuterMessages,
} from "@/app/(dashboard)/dashboard/basic-chat/puterBrowser";

describe("Puter browser provider", () => {
  it("is registered as the official 'puter' provider, listed via /api/models/free like any other free provider", () => {
    expect(PUTER_PROVIDER_ID).toBe("puter");
  });

  it("recognizes any model under the puter provider as browser-only", () => {
    expect(isPuterBrowserModel({
      id: "puter/xiaomi/mimo-v2.5",
      requestModel: "puter/xiaomi/mimo-v2.5",
      name: "Xiaomi MiMo V2.5 (Puter)",
      providerId: PUTER_PROVIDER_ID,
      providerName: "Puter (MiMo)",
      source: "catalog",
    })).toBe(true);
    expect(isPuterBrowserModel({
      id: "pollinations/openai",
      requestModel: "pollinations/openai",
      name: "OpenAI (Pollinations)",
      providerId: "pollinations",
      providerName: "Pollinations AI",
      source: "catalog",
    })).toBe(false);
  });

  it("builds a provider-safe transcript without the pending assistant placeholder", () => {
    expect(toPuterMessages([
      { id: "user-1", role: "user", content: " hello " },
      { id: "pending", role: "assistant", content: "" },
      { id: "assistant-1", role: "assistant", content: " world " },
    ], "pending", " Be concise. ")).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
  });

  it("uses the official SDK session and streams text without reading browser storage", async () => {
    let signInCalls = 0;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        puter: {
          auth: {
            isSignedIn: () => false,
            signIn: async () => { signInCalls += 1; },
          },
          ai: {
            chat: async () => (async function* () {
              yield { text: "Mi" };
              yield { text: "Mo" };
            })(),
          },
        },
      },
    });

    const deltas: string[] = [];
    await expect(streamPuterChat({
      messages: [{ role: "user", content: "Reply only OK" }],
      onTextDelta: (delta) => deltas.push(delta),
      signal: new AbortController().signal,
    })).resolves.toBe("MiMo");

    expect(signInCalls).toBe(1);
    expect(deltas).toEqual(["Mi", "Mo"]);
    delete (globalThis as { window?: unknown }).window;
  });
});
