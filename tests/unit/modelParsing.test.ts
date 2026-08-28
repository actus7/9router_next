import { describe, it, expect } from "vitest";
import {
  parseModel,
  resolveProviderAlias,
  resolveModelAliasFromMap,
} from "@/server/llm-gateway/engine/services/model";

// â”€â”€ parseModel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("parseModel", () => {
  it("'openai/gpt-4o' â†’ provider openai + model gpt-4o", () => {
    const r = parseModel("openai/gpt-4o");
    expect(r.provider).toBe("openai");
    expect(r.model).toBe("gpt-4o");
    expect(r.isAlias).toBe(false);
    expect(r.providerAlias).toBe("openai");
  });

  it("'anthropic/claude-sonnet-4-20250514' â†’ provider anthropic", () => {
    const r = parseModel("anthropic/claude-sonnet-4-20250514");
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe("claude-sonnet-4-20250514");
    expect(r.isAlias).toBe(false);
  });

  it("bare model (no slash) â†’ isAlias=true, provider=null", () => {
    const r = parseModel("gpt-4o");
    expect(r.provider).toBeNull();
    expect(r.model).toBe("gpt-4o");
    expect(r.isAlias).toBe(true);
    expect(r.providerAlias).toBeNull();
  });

  it("empty string â†’ all null, isAlias=false", () => {
    const r = parseModel("");
    expect(r).toEqual({ provider: null, model: null, isAlias: false, providerAlias: null });
  });

  it("malformed '///' â†’ does not throw, captures actual behavior", () => {
    // first slash at index 0 â†’ providerOrAlias=""  model="//"
    expect(() => parseModel("///")).not.toThrow();
    const r = parseModel("///");
    expect(r.provider).toBe("");
    expect(r.model).toBe("//");
    expect(r.isAlias).toBe(false);
  });

  it("no-slash model 'claude-sonnet-4-20250514' â†’ isAlias=true", () => {
    const r = parseModel("claude-sonnet-4-20250514");
    expect(r.provider).toBeNull();
    expect(r.model).toBe("claude-sonnet-4-20250514");
    expect(r.isAlias).toBe(true);
  });

  it("provider/model with multiple slashes â†’ splits at first slash only", () => {
    const r = parseModel("openrouter/deepseek/deepseek-chat");
    expect(r.provider).toBe("openrouter");
    expect(r.model).toBe("deepseek/deepseek-chat");
  });
});

// â”€â”€ resolveProviderAlias â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("resolveProviderAlias", () => {
  it("known id resolves to itself", () => {
    expect(resolveProviderAlias("openai")).toBe("openai");
  });

  it("unknown alias returns input unchanged (passthrough)", () => {
    expect(resolveProviderAlias("totally-unknown-xyz")).toBe("totally-unknown-xyz");
  });
});

// â”€â”€ resolveModelAliasFromMap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
describe("resolveModelAliasFromMap", () => {
  const aliases = {
    fast: "openai/gpt-4o-mini",
    smart: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  };

  it("resolves string 'provider/model' alias", () => {
    const r = resolveModelAliasFromMap("fast", aliases);
    expect(r).toEqual({ provider: "openai", model: "gpt-4o-mini" });
  });

  it("resolves object {provider, model} alias", () => {
    const r = resolveModelAliasFromMap("smart", aliases);
    expect(r).toEqual({ provider: "anthropic", model: "claude-sonnet-4-20250514" });
  });

  it("missing key â†’ null", () => {
    expect(resolveModelAliasFromMap("nonexistent", aliases)).toBeNull();
  });

  it("null aliases map â†’ null", () => {
    expect(resolveModelAliasFromMap("fast", null)).toBeNull();
  });

  it("undefined aliases map â†’ null", () => {
    expect(resolveModelAliasFromMap("fast", undefined)).toBeNull();
  });

  it("empty aliases map â†’ null", () => {
    expect(resolveModelAliasFromMap("fast", {})).toBeNull();
  });
});
