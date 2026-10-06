import { beforeEach, describe, expect, it, vi } from "vitest";

const evaluateJev = vi.fn();
vi.mock("@/server/decisions/jev", () => ({ evaluateJev: (...args: unknown[]) => evaluateJev(...args) }));

import { systemOneFusionJudge } from "@/server/llm-gateway/application/fusionJudge";

const input = {
  model: "typesafe-ai/jev",
  request: "What is 2+2?",
  answers: [{ text: "It is 5" }, { text: "It is 4" }],
};

beforeEach(() => evaluateJev.mockReset());

describe("systemOneFusionJudge", () => {
  it("maps the chosen source back to a panel index, asking the configured model", async () => {
    evaluateJev.mockResolvedValue({ best: { type: "choice", choice: "source_2", confidence: 0.93, probabilities: {} } });
    expect(await systemOneFusionJudge(input)).toEqual({ index: 1, confidence: 0.93 });

    const [state, questions, , model] = evaluateJev.mock.calls[0];
    expect(model).toBe("typesafe-ai/jev");
    expect(state).toContain("What is 2+2?");
    expect(state).toContain("[Source 2]\nIt is 4");
    expect(Object.keys(questions.best.criteria)).toEqual(["source_1", "source_2"]);
  });

  it("answers null when Jev is unavailable", async () => {
    evaluateJev.mockResolvedValue(null);
    expect(await systemOneFusionJudge(input)).toBeNull();
  });

  it("answers null for a choice outside the sources", async () => {
    evaluateJev.mockResolvedValue({ best: { type: "choice", choice: "source_9", confidence: 0.9, probabilities: {} } });
    expect(await systemOneFusionJudge(input)).toBeNull();
  });

  it("does not call Jev with fewer than two answers", async () => {
    expect(await systemOneFusionJudge({ ...input, answers: [{ text: "only" }] })).toBeNull();
    expect(evaluateJev).not.toHaveBeenCalled();
  });
});
