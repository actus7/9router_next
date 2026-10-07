import { beforeEach, describe, expect, it } from "vitest";

import {
  _clearThoughtSignatures,
  getGeminiThoughtSignatureSync,
  signatureFamily,
  storeGeminiThoughtSignature,
} from "@/server/llm-gateway/engine/services/thoughtSignatureStore";

/**
 * Antigravity serves Gemini and Claude behind one API and each backend only
 * accepts its own signatures: replaying a Claude one to Gemini is a 400
 * "Corrupted thought signature". Signatures are looked up by tool_call_id,
 * namespaced by session, and never cross model families
 * (ported from decolua/9router thoughtSignatureStore.js).
 */
beforeEach(() => _clearThoughtSignatures());

describe("signatureFamily", () => {
  it("separates claude and gemini; keeps the id for anything else", () => {
    expect(signatureFamily("claude-sonnet-4-6")).toBe("claude");
    expect(signatureFamily("gemini-3.1-pro-low")).toBe("gemini");
    expect(signatureFamily("gpt-oss-120b-medium")).toBe("gpt-oss-120b-medium");
    expect(signatureFamily(null)).toBeNull();
  });
});

describe("thought signature store", () => {
  it("replays a signature for the same tool call", () => {
    storeGeminiThoughtSignature("call-1", "sig-a", "s1", "gemini-3.1-pro-low");

    expect(getGeminiThoughtSignatureSync("call-1", "s1", "gemini-3.1-pro-low")).toBe("sig-a");
  });

  it("does not replay across model families", () => {
    storeGeminiThoughtSignature("call-1", "sig-claude", "s1", "claude-sonnet-4-6");

    expect(getGeminiThoughtSignatureSync("call-1", "s1", "gemini-3.1-pro-low")).toBeNull();
    expect(getGeminiThoughtSignatureSync("call-1", "s1", "claude-opus-4-6-thinking")).toBe("sig-claude");
  });

  it("prefers the session namespace so two sessions reusing an id do not collide", () => {
    storeGeminiThoughtSignature("call-1", "sig-s1", "s1", "gemini-3.1-pro-low");
    storeGeminiThoughtSignature("call-1", "sig-s2", "s2", "gemini-3.1-pro-low");

    expect(getGeminiThoughtSignatureSync("call-1", "s1", "gemini-3.1-pro-low")).toBe("sig-s1");
    expect(getGeminiThoughtSignatureSync("call-1", "s2", "gemini-3.1-pro-low")).toBe("sig-s2");
  });

  it("ignores empty ids and signatures", () => {
    storeGeminiThoughtSignature("", "sig", "s1");
    storeGeminiThoughtSignature("call-1", "", "s1");

    expect(getGeminiThoughtSignatureSync("call-1", "s1")).toBeNull();
  });
});
