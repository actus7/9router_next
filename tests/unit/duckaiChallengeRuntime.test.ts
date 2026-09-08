import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDuckAiChallengeRuntime } from "@/server/llm-gateway/engine/executors/duckai-challenge";

const KEYS = [
  "DUCKAI_CHALLENGE_RUNTIME",
  "DUCKAI_ALLOW_UNTRUSTED_CHALLENGE_CODE",
  "DUCKAI_BROWSER_FALLBACK",
  "DUCKAI_BROWSER_WS_ENDPOINT",
  "VERCEL",
] as const;

describe("Duck.ai challenge runtime selection", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("defaults to the jsdom solver, which needs no browser", () => {
    expect(getDuckAiChallengeRuntime()).toBe("jsdom-dangerous");
  });

  it("still uses jsdom on serverless — defaulting to 'off' there disabled the provider outright", () => {
    process.env.VERCEL = "1";
    expect(getDuckAiChallengeRuntime()).toBe("jsdom-dangerous");
  });

  it("needs no separate opt-in flag to reach the jsdom solver", () => {
    process.env.DUCKAI_CHALLENGE_RUNTIME = "jsdom";
    expect(getDuckAiChallengeRuntime()).toBe("jsdom-dangerous");

    process.env.DUCKAI_CHALLENGE_RUNTIME = "jsdom-dangerous";
    expect(getDuckAiChallengeRuntime()).toBe("jsdom-dangerous");
  });

  it("prefers a configured remote browser, which solves out of process", () => {
    process.env.DUCKAI_BROWSER_WS_ENDPOINT = "wss://browser.example/session";
    expect(getDuckAiChallengeRuntime()).toBe("browser");
  });

  it("honours explicit overrides", () => {
    for (const [value, expected] of [
      ["browser", "browser"],
      ["puppeteer", "browser"],
      ["off", "off"],
      ["disabled", "off"],
    ] as const) {
      process.env.DUCKAI_CHALLENGE_RUNTIME = value;
      expect(getDuckAiChallengeRuntime()).toBe(expected);
    }
  });
});
