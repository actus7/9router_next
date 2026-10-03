import { describe, expect, it } from "vitest";
import {
  canonicalModelKey,
  compareVersions,
  isChatModel,
  modelFamily,
} from "@/server/llm-gateway/engine/services/smart-routing/modelIdentity";

/**
 * Model identity for the suggestion board: one key for the same model served by
 * several providers, a family + version to tell generations apart, and the
 * name-level filter that keeps non-chat models out of chat lanes.
 */

describe("canonicalModelKey", () => {
  it("collapses provider prefixes, spelling and free-tier suffixes", () => {
    const key = canonicalModelKey("mimo-v2.5-pro");
    expect(canonicalModelKey("xiaomi/mimo-v2.5-pro")).toBe(key);
    expect(canonicalModelKey("MiMo-V2.5-Pro")).toBe(key);
    expect(canonicalModelKey("mimo-v2.5-pro:free")).toBe(key);
  });

  it("treats dated snapshots as the same model", () => {
    expect(canonicalModelKey("qwen3.8-max-0902")).toBe(canonicalModelKey("qwen3.8-max"));
    expect(canonicalModelKey("claude-sonnet-4-5-20250929")).toBe(canonicalModelKey("claude-sonnet-4.5"));
  });

  it("keeps size and product words that make a different model", () => {
    expect(canonicalModelKey("glm-5.3-flash")).not.toBe(canonicalModelKey("glm-5.3"));
    expect(canonicalModelKey("fugu-max")).not.toBe(canonicalModelKey("fugu-ultra"));
  });
});

describe("modelFamily", () => {
  it("splits family words from the version number", () => {
    expect(modelFamily("gemini-3.1-pro-preview")).toEqual({ family: "gemini pro", version: [3, 1] });
    expect(modelFamily("gemini-2.5-pro")).toEqual({ family: "gemini pro", version: [2, 5] });
    expect(modelFamily("mimo-v2.6-pro")).toEqual({ family: "mimo pro", version: [2, 6] });
    expect(modelFamily("qwen3.8-max")).toEqual({ family: "qwen max", version: [3, 8] });
    expect(modelFamily("claude-opus-4-8")).toEqual({ family: "claude opus", version: [4, 8] });
  });

  it("appends a dated snapshot as the last version component", () => {
    expect(modelFamily("qwen3.8-max-0902")).toEqual({ family: "qwen max", version: [3, 8, 902] });
  });

  it("returns null when there is no version to compare", () => {
    expect(modelFamily("kiro/auto")).toBeNull();
    expect(modelFamily("fugu-max")).toBeNull();
  });

  it("drops reasoning-effort words so an effort variant joins its model's family", () => {
    expect(modelFamily("gemini-3.1-pro-low")).toEqual({ family: "gemini pro", version: [3, 1] });
    expect(modelFamily("gpt-5.6-luna-xhigh")?.family).toBe("gpt luna");
    // "max" names a product (Qwen Max, Fugu Max), never an effort level.
    expect(modelFamily("qwen3.8-max")?.family).toBe("qwen max");
  });

  it("keeps size words in the family so flash never supersedes pro", () => {
    expect(modelFamily("mimo-v2.6-flash")?.family).not.toBe(modelFamily("mimo-v2.5-pro")?.family);
  });
});

describe("compareVersions", () => {
  it("orders numerically, component by component", () => {
    expect(compareVersions([3, 1], [2, 5])).toBeGreaterThan(0);
    expect(compareVersions([2, 10], [2, 9])).toBeGreaterThan(0);
    expect(compareVersions([3], [3, 1])).toBeLessThan(0);
    expect(compareVersions([4, 8], [4, 8])).toBe(0);
  });
});

describe("isChatModel", () => {
  it("rejects music, video, image, speech, translation and research agents", () => {
    for (const id of ["lyria-3-pro-preview", "veo-3", "imagen-4", "gemini-2.5-flash-image", "tts-1", "whisper-1",
      "text-embedding-3-large", "deep-research-pro-preview", "hunyuan-mt2-pro", "Hy-MT2-Pro"]) {
      expect(isChatModel(id), id).toBe(false);
    }
  });

  it("accepts ordinary chat models, multimodal ones included", () => {
    for (const id of ["gpt-5.6-luna", "mimo-v2-omni", "claude-opus-5", "glm-5.3-flashx", "deepseek-v4-pro", "kiro/auto"]) {
      expect(isChatModel(id), id).toBe(true);
    }
  });
});
