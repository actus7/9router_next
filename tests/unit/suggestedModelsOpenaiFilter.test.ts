import { describe, expect, it } from "vitest";
import { FILTERS } from "@/app/api/providers/suggested-models/filters";

describe("openai models filter", () => {
  it("drops non-chat entries and safety classifiers (OVH Qwen3Guard)", () => {
    const ids = FILTERS.openai([
      { id: "gpt-oss-120b", max_completion_tokens: 131072 },
      { id: "bge-m3", max_completion_tokens: 0 },
      { id: "Qwen3Guard-Gen-8B", max_completion_tokens: 16384 },
      { id: "Llama-Guard-4-12B" },
      { id: "Mistral-Nemo-Instruct-2407" },
    ]).map((m) => m.id);
    expect(ids).toEqual(["gpt-oss-120b", "Mistral-Nemo-Instruct-2407"]);
  });
});
